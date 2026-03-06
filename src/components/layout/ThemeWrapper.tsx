'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export default function ThemeWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    useEffect(() => {
        if (pathname.startsWith('/pm')) {
            document.body.classList.add('pm-theme');
        } else {
            document.body.classList.remove('pm-theme');
        }

        // Cleanup on unmount (less critical since it stays in the browser layout, but good practice)
        return () => {
            document.body.classList.remove('pm-theme');
        };
    }, [pathname]);

    return <>{children}</>;
}
