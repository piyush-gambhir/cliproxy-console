import {createContext, useContext} from 'react';
export const FieldId = createContext<string|undefined>(undefined);
export const useFieldId = () => useContext(FieldId);
