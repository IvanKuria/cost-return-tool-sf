import { Children, cloneElement, isValidElement, useId, useState, type ReactNode, type InputHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Button as ShadButton } from '@/components/ui/button';
import { Card as ShadCard } from '@/components/ui/card';
import { Input as ShadInput } from '@/components/ui/input';
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n';
import type { Citation } from '@/lib/types';
import { sourceStatus } from '@/lib/source';

// The screens only use these. They are thin wrappers over shadcn/ui so the whole app shares
// one component library, with sizes bumped for farmers on a phone in bright sun.

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, 'default' | 'outline' | 'ghost' | 'destructive'> = {
  primary: 'default', secondary: 'outline', ghost: 'ghost', danger: 'destructive',
};

export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <ShadButton
      variant={VARIANT[variant]}
      className={cn(
        'h-12 px-5 rounded-[var(--radius-ctl)] text-[16px] font-semibold',
        variant === 'secondary' && 'border-line-strong text-ink',
        variant === 'ghost' && 'text-ink-2 hover:text-ink',
        variant === 'danger' && 'bg-transparent text-loss hover:bg-loss-soft',
        className,
      )}
      {...p}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ShadCard className={cn('block flex-row gap-0 py-0 overflow-visible rounded-[var(--radius-card)] bg-ground text-[16px] ring-0 border border-line', className)}>
      {children}
    </ShadCard>
  );
}

export function Field({ label, hint, children, tag }: { label: string; hint?: ReactNode; children: ReactNode; tag?: ReactNode }) {
  const generatedId = useId();
  const first = Children.toArray(children).find(child => isValidElement<{ id?: string }>(child));
  const id = isValidElement<{ id?: string }>(first) ? first.props.id ?? generatedId : generatedId;
  return (
    <div className="flex flex-col items-stretch gap-0 font-normal text-[16px]" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
        <Label id={`${id}-label`} htmlFor={id} className="font-medium text-[15px]">{label}</Label>
        {tag}
      </div>
      {Children.map(children, child => isValidElement<{ id?: string; 'aria-label'?: string; 'aria-describedby'?: string }>(child)
        ? cloneElement(child, { id: child.props.id ?? id, 'aria-label': child.props['aria-label'] ?? label, 'aria-describedby': [child.props['aria-describedby'], hint ? `${id}-hint` : undefined].filter(Boolean).join(' ') || undefined }) : child)}
      {hint && <span id={`${id}-hint`} className="mt-1.5 text-[14px] text-ink-2 leading-snug">{hint}</span>}
    </div>
  );
}

/** Text input with optional prefix ($) and suffix (unit). Numbers are right aligned. */
export function Input({ prefix, suffix, numeric, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string; numeric?: boolean }) {
  return (
    <span className={cn('flex items-stretch h-12 rounded-[var(--radius-ctl)] border border-line-strong bg-ground overflow-hidden focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/25', className)}>
      {prefix && <span className="flex items-center pl-3.5 pr-1 text-ink-3 text-[16px]">{prefix}</span>}
      <ShadInput
        className={cn('h-full flex-1 min-w-0 rounded-none border-0 px-3.5 text-[17px] md:text-[17px] focus-visible:ring-0 focus-visible:border-0', numeric && 'text-right tnum', prefix && 'pl-1')}
        inputMode={numeric ? 'decimal' : undefined}
        {...p}
      />
      {suffix && <span className="flex items-center px-3.5 text-ink-2 text-[15px] bg-well border-l border-line whitespace-nowrap">{suffix}</span>}
    </span>
  );
}

/** Keep the user's in-progress decimal text; an empty value can remain explicitly missing. */
export function NumberInput({ value, onChange, step, plain, blankZero, missing, onMissingChange, min = 0, onFocus, onBlur, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; step?: number; plain?: boolean; blankZero?: boolean; missing?: boolean; onMissingChange?: (missing: boolean) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = missing || !Number.isFinite(value) || (blankZero && value === 0) ? '' : (plain || (step && step < 1) ? value.toString() : value.toLocaleString('en-US'));
  return <Input numeric {...p} min={min} value={editing ?? shown}
    onFocus={e => { setEditing(missing ? '' : value.toString()); onFocus?.(e); }}
    onBlur={e => { setEditing(null); onBlur?.(e); }}
    onChange={e => {
      const raw = e.target.value.replace(/,/g, '');
      if (!/^-?\d*\.?\d*$/.test(raw)) return;
      setEditing(raw);
      if (raw === '') { if (onMissingChange) onMissingChange(true); else onChange(0); return; }
      const n = Number(raw);
      if (raw !== '.' && Number.isFinite(n) && n >= Number(min)) onChange(n);
    }} />;
}

/**
 * Select built on shadcn/Radix. Accepts plain <option> children like a native select and calls
 * onChange with an event-shaped object so existing screens keep working.
 */
export function Select({ value, onChange, children, className, placeholder, id, 'aria-label': ariaLabel, 'aria-describedby': describedBy }: {
  value: string; onChange: (e: { target: { value: string } }) => void; children: ReactNode; className?: string; placeholder?: string; id?: string; 'aria-label'?: string; 'aria-describedby'?: string;
}) {
  const options: { value: string; label: ReactNode }[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement<{ value?: string; children?: ReactNode }>(child) && child.type === 'option') {
      const v = child.props.value ?? String(child.props.children);
      options.push({ value: String(v), label: child.props.children });
    }
  });
  return (
    <ShadSelect value={value} onValueChange={(v) => onChange({ target: { value: v } })}>
      <SelectTrigger id={id} aria-label={ariaLabel} aria-describedby={describedBy} className={cn('h-12 w-full rounded-[var(--radius-ctl)] border-line-strong bg-ground px-3.5 text-[17px] data-[size=default]:h-12 focus-visible:border-accent focus-visible:ring-accent/25', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[16px] py-2.5">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

/** A row of mutually exclusive choices. Big enough to tap in a truck. */
export function Choice<T extends string>({ value, onChange, options, id, 'aria-label': ariaLabel, 'aria-describedby': describedBy }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; id?: string; 'aria-label'?: string; 'aria-describedby'?: string }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }} role="radiogroup" id={id} aria-label={ariaLabel} aria-describedby={describedBy}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <ShadButton
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            variant="outline"
            onClick={() => onChange(o.value)}
            className={cn('h-12 px-2 rounded-[var(--radius-ctl)] text-[15px] font-medium whitespace-normal leading-tight', on ? 'border-accent bg-accent-soft text-accent-deep hover:bg-accent-soft hover:text-accent-deep' : 'border-line-strong text-ink-2')}
          >
            {o.label}
          </ShadButton>
        );
      })}
    </div>
  );
}

/** Where a study number came from: title, year, region, page, the quoted line, and a link to the PDF. */
export function CitationCard({ citation, className }: { citation: Citation; className?: string }) {
  const { t } = useT();
  const where = [citation.year, citation.region].filter(Boolean).join(', ');
  return (
    <div className={cn('rounded-[var(--radius-ctl)] border border-line bg-well px-3.5 py-3 text-[14px] leading-snug flex flex-col gap-1.5', className)}>
      <div className="font-medium text-ink">{citation.title}{where ? `, ${where}` : ''}</div>
      {citation.field && <div className="text-ink-2">{citation.field}{citation.value !== null ? `: ${citation.value.toLocaleString('en-US')}` : ''}</div>}
      <blockquote className="text-ink-2 border-l-2 border-line-strong pl-2.5 italic">{citation.quote}</blockquote>
      <a href={`${citation.url.split('#')[0]}#page=${citation.page}`} target="_blank" rel="noreferrer" className="text-accent font-medium underline underline-offset-2 self-start">
        {t('source.openPdf', { page: citation.page })}
      </a>
    </div>
  );
}

/** The current input's provenance, with the original citation available on demand. */
export function SourceTag({ citation, value, missing = false, onRestore, restoreHint }: { citation: Citation | undefined; value: number; missing?: boolean; onRestore?: () => void; restoreHint?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const status = !missing && restoreHint ? 'yours' : sourceStatus(value, citation, missing);
  const label = t(status === 'missing' ? 'source.missing' : status === 'study' ? 'source.fromStudy' : 'source.yours');
  const classes = cn('text-[12px] font-medium rounded-full px-2 py-1 border', status === 'study' ? 'text-accent-deep bg-accent-soft border-accent/30' : 'text-ink-2 bg-well border-line');
  if (!citation) return <span className={classes}>{label}</span>;
  return <>
    <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={id} aria-label={`${label}: ${citation.field}`} className={classes}>{label}</button>
    {open && <div id={id} className="basis-full mt-1 space-y-2">
      <CitationCard citation={citation} />
      {restoreHint && <p className="text-[14px] text-ink-2">{restoreHint}</p>}
      {onRestore && citation.value !== null && Number.isFinite(citation.value) && status !== 'study' && <button type="button" className="text-[14px] font-medium text-accent underline underline-offset-2 py-2" onClick={onRestore}>{t('source.restore')}</button>}
    </div>}
  </>;
}

export const money = (n: number, opts: { sign?: boolean } = {}) => {
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  if (n < 0) return `−$${abs}`;
  return (opts.sign ? '+' : '') + `$${abs}`;
};
export const cents = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const num = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
