import {useFieldId} from './field-context';
import type {ComponentProps, ReactNode} from 'react';
import {Input} from './ui/input';
import {Checkbox} from './ui/checkbox';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './ui/select';

const EMPTY = '__console_empty_selection__';
/** App-level composition of shadcn's accessible Select primitives. */
export function SelectField({children, value, onChange, className, style, ...props}: Omit<ComponentProps<typeof SelectTrigger>, 'onChange'|'value'> & {value?: string; onChange?: (event: {target:{value:string}}) => void; children: ReactNode}) {
  const fieldId = useFieldId();
  return <Select value={value || EMPTY} onValueChange={v => onChange?.({target:{value:v === EMPTY ? '' : v}})} disabled={props.disabled}>
    <SelectTrigger id={fieldId} {...props} className={className} style={style}><SelectValue /></SelectTrigger>
    <SelectContent>{children}</SelectContent>
  </Select>;
}
export function SelectChoice({value, children, disabled}: {value?: string;children: ReactNode;disabled?:boolean}) {
  return <SelectItem value={(value ?? String(children)) || EMPTY} disabled={disabled}>{children}</SelectItem>;
}
export function FormInput({type, onChange, ...props}: Omit<ComponentProps<typeof Input>, 'onChange'> & {onChange?: (event: {target:{value:string;checked:boolean}}) => void}) {
  const fieldId = useFieldId();
  if (type === 'checkbox') {
    const {checked, disabled, id, name, className, style, 'aria-label':ariaLabel} = props;
    return <Checkbox checked={checked} disabled={disabled} id={id ?? fieldId} name={name} className={className} style={style} aria-label={ariaLabel} onCheckedChange={checked => onChange?.({target:{checked:checked === true,value:''}})} />;
  }
  return <Input id={fieldId} {...props} type={type === 'datetime-local' ? 'text' : type} placeholder={type === 'datetime-local' ? 'YYYY-MM-DDTHH:mm' : props.placeholder} onChange={onChange} />;
}
