import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./admin.css";
import "./admin-controls.css";

export const metadata: Metadata = {
  title: "관리자 | 모두의 문제집",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
