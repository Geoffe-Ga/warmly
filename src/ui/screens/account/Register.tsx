import type { JSX } from "preact";
import { useContext, useState } from "preact/hooks";

import { Link, NavigationContext } from "../../../app/navigation";
import { pathFor } from "../../../app/routes";
import { useServices } from "../../../app/services";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import {
  AccountForm,
  MIN_PASSWORD_LENGTH,
  emailError,
  newPasswordError,
  useAction,
} from "./shared";

interface FieldErrors {
  readonly email?: string | undefined;
  readonly password?: string | undefined;
}

/**
 * Create an account with an email address and a password. The password signs
 * the user in; it never unlocks their journal, and the screen says so.
 *
 * @returns The registration screen.
 */
export function Register(): JSX.Element {
  const { auth } = useServices();
  const { navigate } = useContext(NavigationContext);
  const action = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const next = {
      email: emailError(email),
      password: newPasswordError(password),
    };
    setErrors(next);
    return next.email === undefined && next.password === undefined;
  };

  return (
    <PageLayout
      title="Create your account"
      lead="Your journal is private to you. Accounts are never linked to anyone else's."
    >
      <AccountForm
        action={action}
        validate={validate}
        onValid={async () => {
          await auth.register(email.trim(), password);
          navigate(pathFor("verify-email"));
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
          name="new-password"
          autocomplete="new-password"
          required
          hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters. It signs you in; it does not unlock your journal.`}
          value={password}
          onInput={setPassword}
          error={errors.password}
        />
        <div class="button-row">
          <Button type="submit" variant="primary" disabled={action.busy}>
            Create account
          </Button>
        </div>
      </AccountForm>
      <p>
        Already have an account? <Link href={pathFor("sign-in")}>Sign in</Link>
      </p>
    </PageLayout>
  );
}
