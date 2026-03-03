import { useState, useEffect } from 'react';

export function useStoredState<T>(key: string, initialValue: T) {
    // Initialize state with stored value or fallback
    const [state, setState] = useState<T>(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = sessionStorage.getItem(key);
                if (stored) {
                    return JSON.parse(stored) as T;
                }
            } catch (e) {
                console.error(`Error reading ${key} from sessionStorage`, e);
            }
        }
        return initialValue;
    });

    // Sync state to sessionStorage whenever it changes
    useEffect(() => {
        if (typeof window !== 'undefined') {
            try {
                sessionStorage.setItem(key, JSON.stringify(state));
            } catch (e) {
                console.error(`Error saving ${key} to sessionStorage`, e);
            }
        }
    }, [key, state]);

    return [state, setState] as const;
}

export function useDashboardFilters() {
    const [dateRange, setDateRange] = useStoredState('dashboard_dateRange', '30d');
    const [platform, setPlatform] = useStoredState('dashboard_platform', 'all');
    const [userType, setUserType] = useStoredState('dashboard_userType', 'all');

    return {
        dateRange,
        setDateRange,
        platform,
        setPlatform,
        userType,
        setUserType,
    };
}
