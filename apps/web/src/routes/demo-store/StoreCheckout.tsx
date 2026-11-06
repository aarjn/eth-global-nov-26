import { useState } from "react";
import { PaisaLink, type PaidResult } from "@paisalink/react";

// Everything this shop needs to accept PaisaLink payments.
export default function StoreCheckout(props: { merchant: string; amount: string }) {
  const [paid, setPaid] = useState<PaidResult | null>(null);
  if (paid) {
    return <a href={paid.receiptUrl}>Paid, thank you! View receipt</a>;
  }
  return (
    <PaisaLink
      amount={props.amount}
      merchant={props.merchant}
      memo="Block-print tote bag, order #1042"
      apiUrl={import.meta.env.VITE_API_URL}
      onPaid={setPaid}
    />
  );
}
