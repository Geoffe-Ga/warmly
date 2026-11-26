import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { LOCKED_PATH } from "../../../app/access";
import { Link, NavigationContext } from "../../../app/navigation";
import type { Onboarding } from "../../../app/onboarding";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import type { KeyVault } from "../../../crypto/key-vault";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { ActionForm, useAction } from "../../components/ActionForm";
import { emailError } from "./shared";

interface FieldErrors {
  readonly email?: string | undefined;
  readonly password?: string | undefined;
}

/**
 * Decide where a newly signed-in user goes, which depends on their keys:
 * a trusted device unlocks locally; an account with keys needs its recovery
 * key on a new device; and an account that never finished setting up (for
 * example, the tab was closed before the recovery key was confirmed) creates
 * its keys now.
 *
 * @param vault - The key vault.
 * @param onboarding - Where a new recovery key is held until confirmed.
 * @returns The path to go to.
 */
export async function afterSignIn(
  vault: KeyVault,
  onboarding: Onboarding,
): Promise<string> {
  if (await vault.hasKeysOnThisDevice()) {
    return LOCKED_PATH;
  }
  if (await vault.accountHasKeys()) {
    return pathFor("recover");
  }
  onboarding.holdRecoveryKey(await vault.createAccountKeys());
  return pathFor("recovery-key");
}

/**
 * Sign in with email and password. Signing in proves who the user is; their
 * journal stays locked until this device unlocks it or they use the recovery
 * key.
 *
 * @returns The sign-in screen.
 */
export function SignIn(): JSX.Element {
  const { auth, vault, session, onboarding } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const next = {
      email: emailError(email),
      password: password === "" ? "Enter your password." : undefined,
    };
    setErrors(next);
    return next.email === undefined && next.password === undefined;
  };

  return (
    <PageLayout title="Sign in" lead="Sign in to your own account.">
      <ActionForm
        action={action}
        validate={validate}
        onValid={async () => {
          await auth.signIn(email.trim(), password);
          const destination = await afterSignIn(vault, onboarding);
          // Change the session and the destination together, with no await
          // between them, so the access rules never see one without the other.
          if (session.state === "signed_out") {
            session.signIn();
          }
          navigate(destination);
        }}
      >
        <TextField
          label="Email"
          type="email"
          name="email"
          autocomplete="email"
          required
          value={email}
          onInput={setEmail}
          error={errors.email}
        />
        <TextField
          label="Password"
          type="password"
          name="current-password"
          autocomplete="current-password"
          required
          value={password}
          onInput={setPassword}
          error={errors.password}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Sign in
          </Button>
        </div>
      </ActionForm>
      <p>
        <Link href={pathFor("reset-password")}>Forgot your password?</Link>
      </p>
      <p>
        New to Warmly?{" "}
        <Link href={pathFor("onboarding")}>Create an account</Link>
      </p>
    </PageLayout>
  );
}
