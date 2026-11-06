// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {PaymentRouter} from "./PaymentRouter.sol";
import {IInvoiceNoteHook} from "./interfaces/IInvoiceNoteHook.sol";

/// @title PaisaLink InvoiceNote
/// @notice Sell an open PaymentRouter invoice for cash today. One contract, many notes; each note has a
///         single holder. Rules enforced here:
///         - only allowlisted investors can fund (the owner is the compliance officer);
///         - a note moves only between allowlisted addresses and only before maturity;
///         - settlement pays exactly `faceValue` USDT to the holder, on or after maturity, from escrow.
///         Escrow is filled on chain: once a note is funded, PaymentRouter forwards the invoice payment
///         here (the merchant cannot withdraw or refund it). If the invoice is not paid by maturity, the
///         issuer (or anyone) can top the escrow up with `repay` (recourse).
contract InvoiceNote is Ownable, ReentrancyGuard, EIP712, Nonces, IInvoiceNoteHook {
    using SafeERC20 for IERC20;

    enum NoteState {
        None,
        Issued,
        Funded,
        Settled
    }

    struct Note {
        bytes32 invoiceId;
        address issuer;
        address holder; // investor after funding, then any allowlisted transferee
        uint256 faceValue; // USDT (6 dp) paid to the holder at settlement
        uint256 price; // USDT the investor pays the issuer at funding (discount = faceValue - price)
        uint256 escrow; // USDT held for settlement
        uint64 maturity;
        NoteState state;
    }

    bytes32 public constant ISSUE_TYPEHASH = keccak256(
        "Issue(bytes32 invoiceId,uint256 faceValue,uint256 price,uint64 maturity,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable usdt;
    PaymentRouter public immutable router;

    uint256 public nextNoteId = 1;
    mapping(uint256 => Note) private _notes;
    mapping(bytes32 => uint256) public noteOfInvoice;
    mapping(address => bool) public allowed;

    event NoteIssued(
        uint256 indexed noteId,
        bytes32 indexed invoiceId,
        address indexed issuer,
        uint256 faceValue,
        uint256 price,
        uint64 maturity
    );
    event NoteFunded(uint256 indexed noteId, address indexed investor, uint256 price);
    event NoteTransferred(uint256 indexed noteId, address indexed from, address indexed to);
    event NoteEscrowFunded(uint256 indexed noteId, address indexed from, uint256 amount);
    event NoteSettled(uint256 indexed noteId, address indexed holder, uint256 faceValue);
    event AllowlistUpdated(address indexed account, bool allowed);

    error ZeroAddress();
    error InvalidTerms();
    error NotIssuer(address caller);
    error InvoiceNotOpen(bytes32 invoiceId);
    error InvoiceAlreadyNoted(bytes32 invoiceId, uint256 noteId);
    error NoteNotFound(uint256 noteId);
    error WrongState(uint256 noteId, NoteState state);
    error NotAllowlisted(address account);
    error NotHolder(address caller);
    error MaturityPassed(uint64 maturity);
    error NotMatured(uint64 maturity);
    error EscrowShort(uint256 escrow, uint256 faceValue);
    error NotRouter(address caller);
    error SignatureExpired(uint256 deadline);
    error InvalidSignature();

    constructor(address usdt_, address router_, address owner_)
        Ownable(owner_)
        EIP712("PaisaLink InvoiceNote", "1")
    {
        if (usdt_ == address(0) || router_ == address(0)) revert ZeroAddress();
        usdt = IERC20(usdt_);
        router = PaymentRouter(router_);
    }

    // ---------------------------------------------------------------- compliance

    function setAllowed(address account, bool isAllowed) external onlyOwner {
        allowed[account] = isAllowed;
        emit AllowlistUpdated(account, isAllowed);
    }

    // ---------------------------------------------------------------- issue

    /// @notice The invoice's merchant issues a note on an open, not yet noted invoice.
    function issue(bytes32 invoiceId, uint256 faceValue, uint256 price, uint64 maturity)
        external
        returns (uint256 noteId)
    {
        return _issue(msg.sender, invoiceId, faceValue, price, maturity);
    }

    /// @notice Relayer-submitted issue authorised by the merchant's EIP-712 `Issue` signature.
    function issueWithSig(
        bytes32 invoiceId,
        uint256 faceValue,
        uint256 price,
        uint64 maturity,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 noteId) {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        address merchant = router.getInvoice(invoiceId).merchant;
        if (merchant == address(0)) revert InvoiceNotOpen(invoiceId);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(ISSUE_TYPEHASH, invoiceId, faceValue, price, maturity, _useNonce(merchant), deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(merchant, digest, signature)) revert InvalidSignature();
        return _issue(merchant, invoiceId, faceValue, price, maturity);
    }

    function _issue(address issuer, bytes32 invoiceId, uint256 faceValue, uint256 price, uint64 maturity)
        internal
        returns (uint256 noteId)
    {
        PaymentRouter.Invoice memory inv = router.getInvoice(invoiceId);
        if (inv.status != PaymentRouter.Status.Open || inv.financed) revert InvoiceNotOpen(invoiceId);
        if (inv.merchant != issuer) revert NotIssuer(issuer);
        uint256 existing = noteOfInvoice[invoiceId];
        if (existing != 0) revert InvoiceAlreadyNoted(invoiceId, existing);
        if (faceValue == 0 || faceValue > inv.amount || price == 0 || price > faceValue) revert InvalidTerms();
        if (maturity <= block.timestamp) revert InvalidTerms();

        noteId = nextNoteId++;
        noteOfInvoice[invoiceId] = noteId;
        Note storage n = _notes[noteId];
        n.invoiceId = invoiceId;
        n.issuer = issuer;
        n.faceValue = faceValue;
        n.price = price;
        n.maturity = maturity;
        n.state = NoteState.Issued;
        emit NoteIssued(noteId, invoiceId, issuer, faceValue, price, maturity);
    }

    // ---------------------------------------------------------------- fund

    /// @notice An allowlisted investor buys the note: pays `price` USDT to the issuer (approve first)
    ///         and becomes the holder. The invoice is marked financed in PaymentRouter.
    function fund(uint256 noteId) external nonReentrant {
        Note storage n = _note(noteId);
        if (n.state != NoteState.Issued) revert WrongState(noteId, n.state);
        if (!allowed[msg.sender]) revert NotAllowlisted(msg.sender);
        if (block.timestamp >= n.maturity) revert MaturityPassed(n.maturity);
        n.holder = msg.sender;
        n.state = NoteState.Funded;
        router.markFinanced(n.invoiceId, noteId); // reverts unless the invoice is still open
        usdt.safeTransferFrom(msg.sender, n.issuer, n.price);
        emit NoteFunded(noteId, msg.sender, n.price);
    }

    // ---------------------------------------------------------------- transfer

    /// @notice Holder moves the note to another allowlisted address, only before maturity.
    function transfer(uint256 noteId, address to) external {
        Note storage n = _note(noteId);
        if (n.state != NoteState.Funded) revert WrongState(noteId, n.state);
        if (msg.sender != n.holder) revert NotHolder(msg.sender);
        if (block.timestamp >= n.maturity) revert MaturityPassed(n.maturity);
        if (!allowed[msg.sender]) revert NotAllowlisted(msg.sender);
        if (!allowed[to]) revert NotAllowlisted(to);
        n.holder = to;
        emit NoteTransferred(noteId, msg.sender, to);
    }

    // ---------------------------------------------------------------- escrow + settle

    /// @inheritdoc IInvoiceNoteHook
    function onInvoicePaid(bytes32 invoiceId, uint256 amount) external {
        if (msg.sender != address(router)) revert NotRouter(msg.sender);
        uint256 noteId = noteOfInvoice[invoiceId];
        Note storage n = _notes[noteId];
        if (n.state == NoteState.Settled) {
            // Already settled through `repay`: the late invoice payment belongs to the issuer.
            usdt.safeTransfer(n.issuer, amount);
        } else {
            n.escrow += amount;
        }
        emit NoteEscrowFunded(noteId, msg.sender, amount);
    }

    /// @notice Tops up the escrow to `faceValue` from the caller (issuer recourse when the invoice is unpaid).
    function repay(uint256 noteId) external nonReentrant {
        Note storage n = _note(noteId);
        if (n.state != NoteState.Funded) revert WrongState(noteId, n.state);
        if (n.escrow >= n.faceValue) revert InvalidTerms();
        uint256 amount = n.faceValue - n.escrow;
        n.escrow = n.faceValue;
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit NoteEscrowFunded(noteId, msg.sender, amount);
    }

    /// @notice On or after maturity, pays exactly `faceValue` USDT to the holder; any escrow above
    ///         `faceValue` returns to the issuer. Anyone may call.
    function settle(uint256 noteId) external nonReentrant {
        Note storage n = _note(noteId);
        if (n.state != NoteState.Funded) revert WrongState(noteId, n.state);
        if (block.timestamp < n.maturity) revert NotMatured(n.maturity);
        if (n.escrow < n.faceValue) revert EscrowShort(n.escrow, n.faceValue);
        uint256 excess = n.escrow - n.faceValue;
        n.escrow = 0;
        n.state = NoteState.Settled;
        usdt.safeTransfer(n.holder, n.faceValue);
        if (excess > 0) usdt.safeTransfer(n.issuer, excess);
        emit NoteSettled(noteId, n.holder, n.faceValue);
    }

    // ---------------------------------------------------------------- views

    function getNote(uint256 noteId) external view returns (Note memory) {
        return _notes[noteId];
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _note(uint256 noteId) internal view returns (Note storage n) {
        n = _notes[noteId];
        if (n.state == NoteState.None) revert NoteNotFound(noteId);
    }
}
