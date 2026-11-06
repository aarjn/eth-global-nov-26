// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Called by PaymentRouter after it has transferred a financed invoice's payment to the note contract.
interface IInvoiceNoteHook {
    function onInvoicePaid(bytes32 invoiceId, uint256 amount) external;
}
