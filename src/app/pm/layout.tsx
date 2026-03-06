import { PMProvider } from "@/store/PMContext";

export default function PMLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <PMProvider>
            {children}
        </PMProvider>
    );
}
