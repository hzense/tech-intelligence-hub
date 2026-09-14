'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from './admin-ai.module.css';

/** Editable suggestions: typing or selecting only changes the model ID, never invokes it. */
export function AdminAiModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: string[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const expanded = open && !disabled;
  const choices = showAll
    ? models
    : models.filter((model) => model.toLowerCase().includes(value.toLowerCase()));
  const active = expanded && activeIndex >= 0 && activeIndex < choices.length;

  useEffect(() => {
    if (active) list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [active, activeIndex]);

  function choose(model: string) {
    if (disabled) return;
    onChange(model);
    setOpen(false);
    setActiveIndex(-1);
    input.current?.focus();
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    // Let input methods finish composition without selecting a suggestion.
    if (disabled || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      // Return to native text editing without committing the highlighted suggestion.
      setActiveIndex(-1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = expanded ? choices.length : models.length;
      if (!expanded) {
        setShowAll(true);
        setOpen(true);
      }
      setActiveIndex(
        count === 0
          ? -1
          : event.key === 'ArrowDown'
            ? Math.min(expanded ? activeIndex + 1 : 0, count - 1)
            : activeIndex < 0 || !expanded
              ? count - 1
              : Math.max(0, activeIndex - 1),
      );
    } else if (event.key === 'Enter' && active) {
      const choice = choices[activeIndex];
      if (choice !== undefined) {
        event.preventDefault();
        choose(choice);
      }
    }
  }

  return (
    <div
      className={styles.modelPicker}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <label htmlFor={`${id}-input`}>模型 ID（搜索、选择或手动输入）</label>
      <div className={styles.modelInput}>
        <input
          ref={input}
          id={`${id}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-list` : undefined}
          aria-activedescendant={active ? `${id}-option-${activeIndex}` : undefined}
          aria-describedby={`ai-model-list-status${expanded ? ` ${id}-status` : ''}`}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          disabled={disabled}
          value={value}
          placeholder="搜索已读取的模型，或输入完整模型 ID"
          onChange={(event) => {
            onChange(event.target.value);
            setShowAll(false);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={navigate}
        />
        <button
          className={styles.modelToggle}
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={expanded ? '收起模型列表' : '展开模型列表'}
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-list` : undefined}
          onClick={() => {
            setShowAll(true);
            setActiveIndex(-1);
            setOpen(!expanded);
            input.current?.focus();
          }}
        >
          <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </button>
      </div>
      {expanded ? (
        <div className={styles.modelPopup}>
          <p id={`${id}-status`} className={styles.modelStatus} role="status">
            {models.length === 0
              ? '尚无模型列表；可先读取列表，也可直接输入完整模型 ID。'
              : choices.length === 0
                ? '没有匹配的模型；可保留手动输入的完整模型 ID。'
                : `显示 ${choices.length} / ${models.length} 个模型；方向键浏览，Enter 选择。`}
          </p>
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="可选模型"
            className={styles.modelOptions}
          >
            {choices.map((model, index) => (
              <button
                key={model}
                id={`${id}-option-${index}`}
                className={styles.modelOption}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(model)}
              >
                {model}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
