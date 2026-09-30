import type {
  AnchorHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

export default function RoutedLink({
  href,
  onNavigate,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  href: string;
  onNavigate: () => void | Promise<void>;
  children: ReactNode;
}) {
  function handleClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return;
    event.preventDefault();
    void onNavigate();
  }
  return <a {...props} href={href} onClick={handleClick}>{children}</a>;
}
