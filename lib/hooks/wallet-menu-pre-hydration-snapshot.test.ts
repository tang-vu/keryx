// @vitest-environment jsdom
// OUTPUT-ONLY / UNRUN proposal. Presentation coverage, never session authority.
import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletMenu } from "../../components/keryx/wallet-menu";
import { createMessages } from "../i18n/messages";
import { webHeaderMessages } from "../../locales/en/web-header";

const collaborators = vi.hoisted(() => {
  const refuse = (operation: string) => vi.fn(() => {
    throw new Error(`Unexpected ${operation} in WalletMenu presentation test`);
  });
  return {
    status: "disconnected" as "disconnected" | "connecting" | "reconnecting",
    signIn: refuse("sign-in"),
    signOut: refuse("sign-out"),
    disconnectAsync: refuse("disconnect"),
    picker: refuse("wallet picker render"),
    fetch: refuse("fetch"),
  };
});

// Only the external status varies. No wallet/provider or authenticated session is
// created; unknown session and no user intent keep authority outside this test.
vi.mock("wagmi", () => ({
  useAccount: () => ({ status: collaborators.status }),
  useDisconnect: () => ({ disconnectAsync: collaborators.disconnectAsync }),
}));
vi.mock("@/lib/hooks/use-siwe-auth", () => ({
  useSiweAuth: () => ({
    address: undefined,
    isConnected: false,
    session: undefined,
    authState: "idle",
    signIn: collaborators.signIn,
    signOut: collaborators.signOut,
  }),
}));
vi.mock("../../components/keryx/wallet-picker", () => ({
  WalletPicker: collaborators.picker,
}));

// Real WalletMenu, React hooks (including its local useHydrated and
// useSyncExternalStore), icons and existing English message keys are retained.
const copy = createMessages("en");
let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  collaborators.status = "disconnected";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", collaborators.fetch);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  try {
    if (root) await act(async () => { root!.unmount(); });
    for (const action of [collaborators.signIn, collaborators.signOut,
      collaborators.disconnectAsync, collaborators.picker, collaborators.fetch]) {
      expect(action).not.toHaveBeenCalled();
    }
  } finally {
    root = undefined;
    host.remove();
    vi.unstubAllGlobals();
  }
});

function expectNeutralChip(chip: Element | null) {
  expect(chip).not.toBeNull();
  expect(chip!.getAttribute("role")).toBe("status");
  expect(chip!.getAttribute("aria-busy")).toBe("true");
  expect(chip!.textContent).toBe(copy("walletMenu.wallet"));
  expect(chip!.querySelector("svg.lucide-wallet")).not.toBeNull();
  expect(chip!.querySelector("svg.animate-spin")).toBeNull();
}

it("renders identical neutral SSR HTML for disconnected, connecting and reconnecting status", () => {
  const snapshots = ["disconnected", "connecting", "reconnecting"].map(status => {
    collaborators.status = status as typeof collaborators.status;
    const html = renderToString(createElement(WalletMenu));
    host.innerHTML = html;
    expectNeutralChip(host.firstElementChild);
    return html;
  });
  expect(snapshots[1]).toBe(snapshots[0]);
  expect(snapshots[2]).toBe(snapshots[0]);
});

it.each(["connecting", "reconnecting"] as const)(
  "hydrates disconnected SSR against %s status without replacing the server chip",
  async status => {
    host.innerHTML = renderToString(createElement(WalletMenu));
    const serverChip = host.firstElementChild;
    expectNeutralChip(serverChip);

    collaborators.status = status;
    const reactErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(host, createElement(WalletMenu), {
        onRecoverableError: error => { reactErrors.push(error); },
        onCaughtError: error => { reactErrors.push(error); },
        onUncaughtError: error => { reactErrors.push(error); },
      });
    });

    // A recovery/remount is a failure, even if its final text looks correct.
    expect(reactErrors).toEqual([]);
    expect(host.firstElementChild).toBe(serverChip);
    if (status === "connecting") {
      expect(serverChip!.textContent).toBe(webHeaderMessages["walletMenu.connecting"]);
      expect(serverChip!.querySelector("svg.animate-spin")).not.toBeNull();
      expect(serverChip!.querySelector("svg.lucide-wallet")).toBeNull();
    } else {
      expectNeutralChip(serverChip);
    }
  },
);
