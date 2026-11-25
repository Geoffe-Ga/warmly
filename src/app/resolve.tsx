/**
 * Decides what a path shows: which screen, or where to go instead. This is the
 * only place a route becomes a screen, so the access rules cannot be skipped.
 */
import type { JSX } from "preact";

import { GALLERY_PATH, Gallery } from "../ui/dev/Gallery";
import { Home } from "../ui/screens/Home";
import { NotFound } from "../ui/screens/NotFound";
import { Placeholder } from "../ui/screens/Placeholder";
import { Settings } from "../ui/screens/Settings";
import { Locked } from "../ui/screens/account/Locked";
import { NewPassword } from "../ui/screens/account/NewPassword";
import { Recover } from "../ui/screens/account/Recover";
import { RecoveryKey } from "../ui/screens/account/RecoveryKey";
import { Register } from "../ui/screens/account/Register";
import { ResetPassword } from "../ui/screens/account/ResetPassword";
import { RotateRecoveryKey } from "../ui/screens/account/RotateRecoveryKey";
import { SignIn } from "../ui/screens/account/SignIn";
import { TrustDevice } from "../ui/screens/account/TrustDevice";
import { VerifyEmail } from "../ui/screens/account/VerifyEmail";
import { AddDevice } from "../ui/screens/devices/AddDevice";
import { ApproveDevice } from "../ui/screens/devices/ApproveDevice";
import { DeviceRevoked } from "../ui/screens/devices/DeviceRevoked";
import { ManageDevices } from "../ui/screens/devices/ManageDevices";
import { Compose } from "../ui/screens/journal/Compose";
import { EditEntry } from "../ui/screens/journal/EditEntry";
import { ConflictReview } from "../ui/screens/sync/ConflictReview";
import { Entry } from "../ui/screens/journal/Entry";
import { Timeline } from "../ui/screens/journal/Timeline";
import { redirectFor } from "./access";
import { matchRoute } from "./router";
import type { RouteDef, RouteId, RouteParams } from "./routes";
import type { SessionState } from "./session";

/** The product name, as shown in the header and the document title. */
export const APP_NAME = "Warmly";

/** What to show for a path: its title and the screen to render. */
export interface View {
  readonly title: string;
  readonly isHome: boolean;
  readonly render: () => JSX.Element;
}

/** What a screen is given: the values of its route's `:name` segments. */
interface ScreenProps {
  readonly params: RouteParams;
}

/** Screens that have been built. Every other route shows a placeholder. */
const SCREENS: Readonly<
  Partial<Record<RouteId, (props: ScreenProps) => JSX.Element>>
> = {
  home: Home,
  journal: Timeline,
  "journal-new": Compose,
  "journal-entry": Entry,
  "journal-edit": EditEntry,
  "sync-conflicts": ConflictReview,
  settings: Settings,
  devices: ManageDevices,
  "approve-device": ApproveDevice,
  "add-device": AddDevice,
  "device-revoked": DeviceRevoked,
  "rotate-recovery-key": RotateRecoveryKey,
  onboarding: Register,
  "verify-email": VerifyEmail,
  "recovery-key": RecoveryKey,
  "sign-in": SignIn,
  "reset-password": ResetPassword,
  "new-password": NewPassword,
  recover: Recover,
  "trust-device": TrustDevice,
  locked: Locked,
};

function viewForRoute(route: RouteDef, params: RouteParams): View {
  const Screen = SCREENS[route.id];
  return {
    title: route.id === "home" ? APP_NAME : route.title,
    isHome: route.id === "home",
    render: () =>
      Screen === undefined ? (
        <Placeholder route={route} />
      ) : (
        <Screen params={params} />
      ),
  };
}

/**
 * Screens that exist for development and testing only. The build mode is a
 * compile-time constant, so in a production build this condition is `false`
 * and the bundler drops the branch and the gallery with it. They are present
 * in development, in unit tests and in the `e2e` build.
 *
 * @param path - A normalised pathname.
 * @returns The development view for that path, if there is one.
 */
function resolveDevView(path: string): View | undefined {
  if (import.meta.env.MODE !== "production" && path === GALLERY_PATH) {
    return {
      title: "Component gallery",
      isHome: false,
      render: () => <Gallery />,
    };
  }
  return undefined;
}

/** The outcome of resolving a path: a screen to show, or somewhere else to go. */
export type Resolution =
  | { readonly kind: "view"; readonly view: View }
  | { readonly kind: "redirect"; readonly to: string };

/**
 * Decide what a path shows for the current session state.
 *
 * A route the session may not see resolves to a redirect, never to a view, so
 * a private screen cannot be rendered while signed out or locked (PRD
 * DEV-005). Paths that match no route carry no private content and resolve to
 * a view in every state.
 *
 * @param path - A normalised pathname.
 * @param state - The current session state.
 * @returns A view, or the path to go to instead.
 */
export function resolve(path: string, state: SessionState): Resolution {
  const match = matchRoute(path);
  if (match) {
    const to = redirectFor(match.route.access, state);
    return to === undefined
      ? { kind: "view", view: viewForRoute(match.route, match.params) }
      : { kind: "redirect", to };
  }
  return {
    kind: "view",
    view: resolveDevView(path) ?? {
      title: "Page not found",
      isHome: false,
      render: () => <NotFound />,
    },
  };
}
