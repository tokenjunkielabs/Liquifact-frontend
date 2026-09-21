import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InvestMarketplace, applySortToList, buildSearchParams, parseFiltersFromSearchParams } from "./page";
import { getMarketplaceHref, sanitizeMarketplaceSearchParams } from "@/lib/marketplaceRoute";

const mockSearchParams = jest.fn(() => new URLSearchParams());
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/invest",
  useSearchParams: () => mockSearchParams(),
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("next/link", () => {
  function MockLink({ href, children, ...props }: any) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  return { __esModule: true, default: MockLink };
});

const mockInvoices = [
  {
    id: "inv-001",
    issuer: "Acme Supplies Ltd",
    amount: "12,500",
    currency: "USD",
    dueDate: "2026-06-15",
    yield: "8.2%",
    status: "Open",
  },
  {
    id: "inv-002",
    issuer: "Bright Logistics GmbH",
    amount: "7,800",
    currency: "EUR",
    dueDate: "2026-07-01",
    yield: "7.5%",
    status: "Funded",
  },
];

describe("marketplace route state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.mockReturnValue(new URLSearchParams());
  });

  it("keeps the route empty when there are no filters", () => {
    expect(getMarketplaceHref(new URLSearchParams())).toBe("/invest");
    expect(sanitizeMarketplaceSearchParams(new URLSearchParams()).toString()).toBe("");
  });

  it("ignores unknown filter values and preserves only supported state", () => {
    const params = new URLSearchParams(
      "q=Acme&currency=CAD&sort=unknown&statuses=Open,Unknown&yieldMin=8.2&yieldMax=9.5&maturityFrom=2026-01-01&maturityTo=2026-12-31"
    );

    expect(sanitizeMarketplaceSearchParams(params).toString()).toBe(
      "q=Acme&yieldMin=8.2&yieldMax=9.5&maturityFrom=2026-01-01&maturityTo=2026-12-31&statuses=Open"
    );
  });

  it("restores supported filter state from a deep link", async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams("q=Acme&statuses=Open,Funded&sort=yield&sortDir=desc")
    );

    render(<InvestMarketplace loadInvoices={async () => mockInvoices} />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: /search by issuer name/i })).toHaveValue("Acme"));
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Funded" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps browser back and forward route state deterministic", () => {
    const previous = parseFiltersFromSearchParams(
      new URLSearchParams("q=Acme&status=Open&statuses=Open,Funded&sort=yield&sortDir=desc")
    );
    const next = parseFiltersFromSearchParams(new URLSearchParams());

    expect(buildSearchParams(previous.filters, previous.searchQuery).toString()).toBe(
      "q=Acme&sort=yield&sortDir=desc&statuses=Open%2CFunded"
    );
    expect(buildSearchParams(next.filters, next.searchQuery).toString()).toBe("");
  });

  it("keeps filter changes stable while the list is still loading", async () => {
    let resolveLoad;
    const loadInvoices = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );

    render(<InvestMarketplace loadInvoices={loadInvoices} />);

    const searchInput = screen.getByRole("textbox", { name: /search by issuer name/i });
    fireEvent.change(searchInput, { target: { value: "Bright" } });
    fireEvent.click(screen.getByRole("button", { name: "Funded" }));

    expect(searchInput).toHaveValue("Bright");
    expect(screen.getByRole("button", { name: "Funded" })).toHaveAttribute("aria-pressed", "true");

    resolveLoad(mockInvoices);
    await waitFor(() => expect(loadInvoices).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Bright Logistics GmbH")).toBeInTheDocument();
  });

  it("round-trips page state while rejecting malformed page parameters", () => {
    const parsed = parseFiltersFromSearchParams(
      new URLSearchParams("q=Acme&sort=amount&sortDir=asc&page=3")
    );

    expect(parsed.page).toBe(3);
    expect(buildSearchParams(parsed.filters, parsed.searchQuery, parsed.page).toString()).toBe(
      "q=Acme&sort=amount&sortDir=asc&page=3"
    );
    expect(sanitizeMarketplaceSearchParams(new URLSearchParams("page=0")).has("page")).toBe(false);
    expect(sanitizeMarketplaceSearchParams(new URLSearchParams("page=2.5")).has("page")).toBe(false);
    expect(sanitizeMarketplaceSearchParams(new URLSearchParams("page=9007199254740992")).has("page")).toBe(false);
  });

  it("keeps equal sort keys stable in their original order", () => {
    const tied = [
      { ...mockInvoices[0], id: "first", amount: "1,000" },
      { ...mockInvoices[1], id: "second", amount: "1,000" },
      { ...mockInvoices[0], id: "third", amount: "2,000" },
    ];

    expect(
      applySortToList(tied, { sort: "amount", sortDir: "asc" }).map((invoice) => invoice.id)
    ).toEqual(["first", "second", "third"]);
  });

  it("restores paginated depth from a shared link", async () => {
    const pagedInvoices = Array.from({ length: 12 }, (_, index) => ({
      ...mockInvoices[index % mockInvoices.length],
      id: `page-invoice-${index + 1}`,
      issuer: `Issuer ${index + 1}`,
    }));
    mockSearchParams.mockReturnValue(new URLSearchParams("page=2"));

    render(<InvestMarketplace loadInvoices={async () => pagedInvoices} />);

    await waitFor(() => expect(screen.getByText("Issuer 12")).toBeInTheDocument());
  });

  it("writes filter changes back to the shareable URL", async () => {
    render(<InvestMarketplace loadInvoices={async () => mockInvoices} />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("statuses=Open"), {
        scroll: false,
      })
    );
  });

});
