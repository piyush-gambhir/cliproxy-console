import {Button} from './ui/button';
import {Badge} from './ui/badge';
import {Label} from './ui/label';
import {Alert, AlertTitle, AlertDescription} from './ui/alert';
import {Card} from './ui/card';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter} from './ui/sheet';
import {Toaster} from './ui/sonner';
import {toast as notify} from 'sonner';
import {FieldId} from './field-context';
import { useCallback, useEffect, useState, useRef, useId, type ReactNode } from 'react';
import { ApiError } from '../api.ts';

export function Chip({
  tone = 'plain',
  children,
  title,
}: {
  tone?: 'ok' | 'warn' | 'err' | 'off' | 'accent' | 'plain';
  children: ReactNode;
  title?: string;
}) {
  return (
    <Badge className={`chip ${tone}`} title={title}>
      {children}
    </Badge>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return <FieldId.Provider value={id}><div className="field"><Label htmlFor={id}>{label}</Label>{children}{hint ? <div className="hint">{hint}</div> : null}</div></FieldId.Provider>;
}

export function Notice({
  tone = 'plain',
  title,
  children,
}: {
  tone?: 'ok' | 'warn' | 'err' | 'plain';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <Alert className={`notice ${tone}`}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** The one state the spec calls out by name: management API off or key rejected. */
export function ManagementOffNotice({ error, onOpenSettings }: { error: ApiError; onOpenSettings: () => void }) {
  const disabled = error.code === 'management_disabled';
  return (
    <Notice tone="warn" title={disabled ? 'Management API disabled' : 'Management key rejected'}>
      <p>
        {disabled ? (
          <>
            Set <code>remote-management.secret-key</code> in{' '}
            your CLIProxyAPI configuration and restart the proxy, then add the same key here.
          </>
        ) : (
          <>The proxy refused this management key. Update it in Settings.</>
        )}
      </p>
      <div className="row">
        <Button className="btn sm" onClick={onOpenSettings}>
          Open settings
        </Button>
      </div>
    </Notice>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="inline-err">{(error as Error).message}</div>;
}

export function Empty({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <Card className="empty">
      <div>{title}</div>
      {action}
    </Card>
  );
}

export function CodeBlock({ label, text }: { label?: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [text]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="copy-wrap">
      <div className="copy-head">
        {label ? <span className="label">{label}</span> : null}
        <span className="spacer" />
        <Button className="btn sm ghost" onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </Button>
      </div>
      <pre className="code">{text}</pre>
    </div>
  );
}

export function Drawer({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return <Sheet open onOpenChange={open => {if (!open) onClose();}}>
    <SheetContent className="drawer" aria-describedby={undefined}>
      <SheetHeader><SheetTitle>{title}</SheetTitle><SheetDescription className="sr-only">Manage {title.toLowerCase()} settings.</SheetDescription></SheetHeader>
      <div className="content">{children}</div>
      {footer && <SheetFooter>{footer}</SheetFooter>}
    </SheetContent>
  </Sheet>;
}

export interface Toast {
  id: number;
  tone: 'ok' | 'err';
  title: string;
  detail?: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const shown = useRef(new Set<number>());
  useEffect(() => {
    for (const entry of toasts) {
      if (shown.current.has(entry.id)) continue;
      shown.current.add(entry.id);
      notify[entry.tone === 'ok' ? 'success' : 'error'](entry.title, {id:entry.id, description:entry.detail, duration:6000, onDismiss:() => onDismiss(entry.id), onAutoClose:() => onDismiss(entry.id)});
    }
  }, [toasts, onDismiss]);
  return <Toaster position="bottom-right" closeButton />;
}
