import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { DemoWalletTag, StateBadge } from "../src/components/ui";
import { PaisaLink } from "@paisalink/react";

afterEach(cleanup);

describe("ui components", () => {
  test("StateBadge shows human copy for each state", () => {
    expect(render(<StateBadge state="open" />).container.textContent).toBe("Awaiting payment");
    cleanup();
    expect(render(<StateBadge state="financed" />).container.textContent).toBe("Sold for cash");
  });

  test("DemoWalletTag always says testnet demo wallet", () => {
    const { container } = render(<DemoWalletTag address="0x32c84603C9848FFa470FB07C9bCe820944D04c52" role="payer" />);
    expect(container.textContent).toContain("Testnet demo payer wallet");
  });

  test("PaisaLink button renders the default label", () => {
    const { getByRole } = render(<PaisaLink amount="49" merchant="0xC038827b4E362B0de1Be859377508613CD028946" />);
    expect(getByRole("button").textContent).toContain("Pay 49 USDT");
  });
});
