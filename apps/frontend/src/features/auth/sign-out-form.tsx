import type { ReactNode } from "react";

export default function SignOutForm({
  action,
  buttonClassName,
  children = "로그아웃",
}: {
  action: string;
  buttonClassName?: string;
  children?: ReactNode;
}) {
  return (
    <form action={action} method="post" className="sign-out-form">
      <button type="submit" className={buttonClassName ?? "sign-out-link"}>
        {children}
      </button>
    </form>
  );
}
