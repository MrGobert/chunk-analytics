'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface AnimatedNumberProps {
    value: number;
    format?: 'number' | 'percentage' | 'ratio' | 'decimal' | 'currency';
    prefix?: string;
    suffix?: string;
    duration?: number;
}

export default function AnimatedNumber({
    value,
    format = 'number',
    prefix = '',
    suffix = '',
    duration = 1.2,
}: AnimatedNumberProps) {
    const nodeRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const node = nodeRef.current;
        if (!node) return;

        const counter = { val: 0 };

        const formatValue = (v: number) => {
            if (format === 'percentage') return (v).toFixed(1) + '%';
            if (format === 'ratio') return v.toFixed(2);
            if (format === 'decimal') return v.toFixed(1);
            if (format === 'currency') {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                }).format(v);
            }
            return new Intl.NumberFormat('en-US').format(Math.floor(v));
        };

        const ctx = gsap.context(() => {
            gsap.to(counter, {
                val: value,
                duration,
                ease: 'power3.out',
                onUpdate: () => {
                    if (nodeRef.current) {
                        nodeRef.current.innerText = prefix + formatValue(counter.val) + suffix;
                    }
                },
            });
        }, nodeRef);

        return () => ctx.revert();
    }, [value, format, prefix, suffix, duration]);

    return <span ref={nodeRef}>{prefix}{format === 'currency' ? '$0.00' : '0'}{suffix}</span>;
}
