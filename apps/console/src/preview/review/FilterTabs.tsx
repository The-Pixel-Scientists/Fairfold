// SPDX-License-Identifier: AGPL-3.0-or-later

export interface FilterOption<Value extends string> {
  value: Value;
  label: string;
  /** How many items the filter would show. */
  count: number;
}

export interface FilterTabsProps<Value extends string> {
  /** Names the group, such as "Show submissions with a status". */
  label: string;
  options: readonly FilterOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}

/**
 * A row of filters that look like tabs but narrow one list on the page, each
 * with its count. The chosen one is bold and underlined, and is also
 * announced as pressed.
 */
export function FilterTabs<Value extends string>({
  label,
  options,
  value,
  onChange,
}: FilterTabsProps<Value>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-x-5 shadow-[inset_0_-1px_0_var(--color-divider)]"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className={[
            'relative flex min-h-control items-center gap-2 px-1 text-body whitespace-nowrap text-muted',
            'transition-colors duration-(--motion-fast) ease-standard hover:text-ink',
            'aria-pressed:font-semibold aria-pressed:text-ink focus-visible:-outline-offset-2',
            "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
            'aria-pressed:after:bg-accent',
          ].join(' ')}
        >
          {option.label}
          <span className="rounded-full bg-sunken px-1.5 text-xs font-medium text-muted tabular-nums">
            {option.count}
          </span>
        </button>
      ))}
    </div>
  );
}
