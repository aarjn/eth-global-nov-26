// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {IEIP3009} from "./interfaces/IEIP3009.sol";
import {IInvoiceNoteHook} from "./interfaces/IInvoiceNoteHook.sol";

/// @title PaisaLink PaymentRouter
/// @notice Invoices paid in USDT on Whitechain. Payers can pay gaslessly with an EIP-3009
///         `receiveWithAuthorization` signature that a relayer submits; merchants can refund and
///         withdraw themselves or by EIP-712 signature (the relayer submits, so merchants never need gas).
///         A financed invoice (see InvoiceNote) forwards its payment to the note escrow instead.
contract PaymentRouter is Ownable, ReentrancyGuard, EIP712, Nonces {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open,
        Paid,
        Refunded,
        Withdrawn
    }

    struct Invoice {
        address merchant;
        uint64 dueAt;
        address payer;
        uint64 paidAt;
        Status status;
        bool financed;
        uint256 amount;
        uint256 balance; // USDT held by the router for this invoice (refundable / withdrawable)
        uint256 refunded; // total refunded to the payer
        uint256 noteId; // InvoiceNote id when financed, else 0
    }

    bytes32 public constant REFUND_TYPEHASH =
        keccak256("Refund(bytes32 invoiceId,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant WITHDRAW_TYPEHASH = keccak256("Withdraw(bytes32 invoiceId,uint256 nonce,uint256 deadline)");

    IERC20 public immutable usdt;
    address public operator;
    address public noteContract;

    mapping(bytes32 => Invoice) private _invoices;

    event InvoiceCreated(bytes32 indexed invoiceId, address indexed merchant, uint256 amount, uint64 dueAt);
    event InvoicePaid(bytes32 indexed invoiceId, address indexed payer, uint256 amount, bool gasless);
    event InvoiceRefunded(bytes32 indexed invoiceId, address indexed to, uint256 amount);
    event Withdrawn(bytes32 indexed invoiceId, address indexed merchant, uint256 amount);
    event InvoiceFinanced(bytes32 indexed invoiceId, uint256 indexed noteId);
    event PaymentForwardedToNote(bytes32 indexed invoiceId, uint256 indexed noteId, uint256 amount);
    event OperatorUpdated(address indexed operator);
    event NoteContractUpdated(address indexed noteContract);

    error ZeroAddress();
    error InvalidAmount();
    error InvoiceExists(bytes32 invoiceId);
    error InvoiceNotFound(bytes32 invoiceId);
    error InvoiceNotOpen(bytes32 invoiceId);
    error NotMerchant(address caller);
    error NotOperator(address caller);
    error NotNoteContract(address caller);
    error WrongValue(uint256 expected, uint256 got);
    error WrongNonce(bytes32 expected, bytes32 got);
    error ExceedsBalance(uint256 available, uint256 requested);
    error NothingToWithdraw(bytes32 invoiceId);
    error SignatureExpired(uint256 deadline);
    error InvalidSignature();
    error AlreadyFinanced(bytes32 invoiceId);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    constructor(address usdt_, address owner_, address operator_)
        Ownable(owner_)
        EIP712("PaisaLink PaymentRouter", "1")
    {
        if (usdt_ == address(0)) revert ZeroAddress();
        usdt = IERC20(usdt_);
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    // ---------------------------------------------------------------- admin

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    function setNoteContract(address noteContract_) external onlyOwner {
        noteContract = noteContract_;
        emit NoteContractUpdated(noteContract_);
    }

    // ---------------------------------------------------------------- create

    /// @notice Merchant creates an invoice directly (merchant pays gas).
    function createInvoice(bytes32 invoiceId, uint256 amount, uint64 dueAt) external {
        _create(invoiceId, msg.sender, amount, dueAt);
    }

    /// @notice Operator (the PaisaLink relayer) creates an invoice for a merchant, so the merchant needs no gas.
    ///         Funds still only ever go to `merchant` (withdraw) or the payer (refund).
    function createInvoiceFor(bytes32 invoiceId, address merchant, uint256 amount, uint64 dueAt)
        external
        onlyOperator
    {
        _create(invoiceId, merchant, amount, dueAt);
    }

    function _create(bytes32 invoiceId, address merchant, uint256 amount, uint64 dueAt) internal {
        if (merchant == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (_invoices[invoiceId].status != Status.None) revert InvoiceExists(invoiceId);
        Invoice storage inv = _invoices[invoiceId];
        inv.merchant = merchant;
        inv.amount = amount;
        inv.dueAt = dueAt;
        inv.status = Status.Open;
        emit InvoiceCreated(invoiceId, merchant, amount, dueAt);
    }

    // ---------------------------------------------------------------- pay

    /// @notice Self-paid path: the payer approved USDT to this router and sends the tx.
    function pay(bytes32 invoiceId) external nonReentrant {
        Invoice storage inv = _openInvoice(invoiceId);
        usdt.safeTransferFrom(msg.sender, address(this), inv.amount);
        _markPaid(invoiceId, inv, msg.sender, false);
    }

    /// @notice Gasless path: anyone (the relayer) submits the payer's EIP-3009 ReceiveWithAuthorization
    ///         signature with `to = address(this)` and `value == invoice.amount`.
    /// @dev The authorization `nonce` MUST equal `paymentNonce(invoiceId)`. This binds the signature to
    ///      one invoice, so a front-runner cannot redirect a payer's signature to a different invoice of
    ///      the same amount.
    function payWithAuthorization(
        bytes32 invoiceId,
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Invoice storage inv = _openInvoice(invoiceId);
        if (value != inv.amount) revert WrongValue(inv.amount, value);
        bytes32 expected = paymentNonce(invoiceId);
        if (nonce != expected) revert WrongNonce(expected, nonce);
        IEIP3009(address(usdt)).receiveWithAuthorization(
            from, address(this), value, validAfter, validBefore, nonce, v, r, s
        );
        _markPaid(invoiceId, inv, from, true);
    }

    /// @notice The EIP-3009 nonce a payer must sign for `invoiceId`.
    function paymentNonce(bytes32 invoiceId) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), invoiceId));
    }

    function _openInvoice(bytes32 invoiceId) internal view returns (Invoice storage inv) {
        inv = _invoices[invoiceId];
        if (inv.status == Status.None) revert InvoiceNotFound(invoiceId);
        if (inv.status != Status.Open) revert InvoiceNotOpen(invoiceId);
    }

    function _markPaid(bytes32 invoiceId, Invoice storage inv, address payer, bool gasless) internal {
        uint256 amount = inv.amount;
        inv.payer = payer;
        inv.paidAt = uint64(block.timestamp);
        inv.status = Status.Paid;
        emit InvoicePaid(invoiceId, payer, amount, gasless);

        if (inv.financed) {
            // Settlement funding for InvoiceNote, enforced on chain: the payment goes straight to the
            // note escrow; the merchant can neither withdraw nor refund it.
            uint256 noteId = inv.noteId;
            address note = noteContract;
            usdt.safeTransfer(note, amount);
            emit PaymentForwardedToNote(invoiceId, noteId, amount);
            IInvoiceNoteHook(note).onInvoicePaid(invoiceId, amount);
        } else {
            inv.balance = amount;
        }
    }

    // ---------------------------------------------------------------- refund / withdraw

    /// @notice Merchant refunds `amount` (partial allowed) from the invoice balance to the recorded payer.
    function refund(bytes32 invoiceId, uint256 amount) external nonReentrant {
        Invoice storage inv = _invoices[invoiceId];
        if (msg.sender != inv.merchant || inv.status == Status.None) revert NotMerchant(msg.sender);
        _refund(invoiceId, inv, amount);
    }

    /// @notice Relayer-submitted refund authorised by the merchant's EIP-712 `Refund` signature.
    function refundWithSig(bytes32 invoiceId, uint256 amount, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
    {
        Invoice storage inv = _invoices[invoiceId];
        if (inv.status == Status.None) revert InvoiceNotFound(invoiceId);
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        address merchant = inv.merchant;
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(REFUND_TYPEHASH, invoiceId, amount, _useNonce(merchant), deadline)));
        if (!SignatureChecker.isValidSignatureNow(merchant, digest, signature)) revert InvalidSignature();
        _refund(invoiceId, inv, amount);
    }

    function _refund(bytes32 invoiceId, Invoice storage inv, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        if (amount > inv.balance) revert ExceedsBalance(inv.balance, amount);
        inv.balance -= amount;
        inv.refunded += amount;
        if (inv.refunded == inv.amount) inv.status = Status.Refunded;
        address to = inv.payer;
        usdt.safeTransfer(to, amount);
        emit InvoiceRefunded(invoiceId, to, amount);
    }

    /// @notice Merchant pulls the remaining invoice balance.
    function withdraw(bytes32 invoiceId) external nonReentrant {
        Invoice storage inv = _invoices[invoiceId];
        if (msg.sender != inv.merchant || inv.status == Status.None) revert NotMerchant(msg.sender);
        _withdraw(invoiceId, inv);
    }

    /// @notice Relayer-submitted withdraw authorised by the merchant's EIP-712 `Withdraw` signature.
    ///         Funds always go to the merchant.
    function withdrawWithSig(bytes32 invoiceId, uint256 deadline, bytes calldata signature) external nonReentrant {
        Invoice storage inv = _invoices[invoiceId];
        if (inv.status == Status.None) revert InvoiceNotFound(invoiceId);
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        address merchant = inv.merchant;
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(WITHDRAW_TYPEHASH, invoiceId, _useNonce(merchant), deadline)));
        if (!SignatureChecker.isValidSignatureNow(merchant, digest, signature)) revert InvalidSignature();
        _withdraw(invoiceId, inv);
    }

    function _withdraw(bytes32 invoiceId, Invoice storage inv) internal {
        uint256 amount = inv.balance;
        if (amount == 0) revert NothingToWithdraw(invoiceId);
        inv.balance = 0;
        inv.status = Status.Withdrawn;
        address merchant = inv.merchant;
        usdt.safeTransfer(merchant, amount);
        emit Withdrawn(invoiceId, merchant, amount);
    }

    // ---------------------------------------------------------------- financing hook

    /// @notice Called by InvoiceNote when an investor funds a note on this invoice. From now on the
    ///         invoice payment is forwarded to the note escrow.
    function markFinanced(bytes32 invoiceId, uint256 noteId) external {
        if (msg.sender != noteContract || msg.sender == address(0)) revert NotNoteContract(msg.sender);
        Invoice storage inv = _openInvoice(invoiceId);
        if (inv.financed) revert AlreadyFinanced(invoiceId);
        inv.financed = true;
        inv.noteId = noteId;
        emit InvoiceFinanced(invoiceId, noteId);
    }

    // ---------------------------------------------------------------- views

    function getInvoice(bytes32 invoiceId) external view returns (Invoice memory) {
        return _invoices[invoiceId];
    }

    /// @notice EIP-712 domain separator for merchant Refund/Withdraw signatures.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
