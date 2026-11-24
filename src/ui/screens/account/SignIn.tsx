import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { LOCKED_PATH } from "../../../app/access";
import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { AccountForm, emailError, useAction } from "./shared";

interface FieldErrors {
  readonly email?: string | undefined;
  readonly password?: string | undefined;
}

/**
 * Sign in with email and password. Signing in proves who the user is; their
 * journal stays locked until this device unlocks it or they use the recovery
 * key.
 *
 * @returns The sign-in screen.
 */
export function SignIn(): JSX.Element {
  const { auth, vault, session } = useServices();
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
      <AccountForm
        action={action}
        validate={validate}
        onValid={async () => {
          await auth.signIn(email.trim(), password);
          const trusted = await vault.hasKeysOnThisDevice();
          // Change the session and the destination together, with no await
          // between them, so the access rules never see one without the other.
          session.signIn();
          navigate(trusted ? LOCKED_PATH : pathFor("recover"));
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
      </AccountForm>
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
