import type { ComponentChildren, JSX } from "preact";

/** Meaning of a {@link StatusBanner}. */
export type StatusTone = "info" | "success" | "warning" | "error";

/** Props for {@link StatusBanner}. */
export interface StatusBannerProps {
  readonly tone: StatusTone;
  /**
   * Short text label for the status, such as "Offline" or "Saved". Shown in
   * words so the meaning never depends on colour alone.
   */
  readonly label: string;
  readonly children: ComponentChildren;
}

/**
 * A status message announced to assistive technology: errors interrupt
 * (`role="alert"`), everything else waits its turn (`role="status"`).
 *
 * Privacy (PRD UI-008, SYNC-010): pass status wording only. Never put journal
 * text, card text or any other private content in a banner, because banners
 * can appear on locked screens and are read aloud.
 *
 * @param props - See {@link StatusBannerProps}.
 * @returns The banner.
 */
export function StatusBanner(props: StatusBannerProps): JSX.Element {
  return (
    <div
      class={`banner banner--${props.tone}`}
      role={props.tone === "error" ? "alert" : "status"}
    >
      <span class="banner__label">{props.label}: </span>
      {props.children}
    </div>
  );
}
