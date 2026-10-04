import { AppContext } from "@/components/AppContext";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <AppContext>{children}</AppContext>;
}
