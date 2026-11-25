import {useEffect,useRef,useState} from 'react';
import type {FormEvent,ReactNode} from 'react';
import {AlertCircle, ChevronLeft, ChevronRight, Inbox, X} from 'lucide-react';
import {api,labels,number} from './api';
import type {Lookups} from './types';

export function useData<T>(path:string, version=0):{data?:T;error?:string}{
  const [result,setResult]=useState<{path:string;data?:T;error?:string}>({path:''});
  const key=path+':'+version;
  useEffect(()=>{
    let active=true;
    api<T>(path).then(data=>{if(active)setResult({path,data})}).catch(e=>{if(active)setResult({path,error:e.message})});
    return ()=>{active=false};
  },[path,key]);
  return result.path===path?result:{};
}
export function Load({error,children,ready}:{error?:string;children:ReactNode;ready:unknown}){
  if(error)return <div role="alert" className="notice error"><AlertCircle size={18}/>{error}</div>;
  if(!ready)return <div className="skeleton" aria-label="Läser in uppgifter"><span/><span/><span/><span/></div>;
  return children;
}
export function Badge({status}:{status:string}){
  return <span className={'badge status-'+status}><i/>{labels[status]??status}</span>;
}
export function Table({headers,rows}:{headers:ReactNode[];rows:ReactNode[][]}){
  if(!rows.length)return <div className="empty"><Inbox size={29}/><strong>Inga poster att visa</strong><span>Ändra filtren eller lägg till en ny post.</span></div>;
  return <div className="table-scroll"><table><thead><tr>{headers.map((h,i)=><th key={i} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div>;
}
export function Pages({page,total,setPage}:{page:number;total:number;setPage:(p:number)=>void}){
  return <div className="pagination"><span>{total?number((page-1)*12+1)+'–'+number(Math.min(page*12,total))+' av '+number(total):'0 poster'}</span><div><button className="icon" aria-label="Föregående sida" disabled={page===1} onClick={()=>setPage(page-1)}><ChevronLeft size={17}/></button><button className="icon" aria-label="Nästa sida" disabled={page*12>=total} onClick={()=>setPage(page+1)}><ChevronRight size={17}/></button></div></div>;
}
export function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close()},[]);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={e=>{e.preventDefault();close()}}><header><h2 id="dialog-title">{title}</h2><button type="button" className="icon" aria-label="Stäng" onClick={close}><X size={20}/></button></header>{children}</dialog>;
}
export function Form({save,children,label='Spara'}:{save:(form:FormData)=>Promise<unknown>;children:ReactNode;label?:string}){
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); if(pending)return;
    const data=new FormData(e.currentTarget,(e.nativeEvent as SubmitEvent).submitter);
    setPending(true); setError('');
    try{await save(data)}catch(e){setError(e instanceof Error?e.message:'Något gick fel.')}finally{setPending(false)}
  }
  return <form onSubmit={submit} className="edit-form"><fieldset disabled={pending}>{children}<footer><button className="primary" type="submit">{pending?'Sparar…':label}</button></footer></fieldset>{error&&<p role="alert" className="notice error">{error}</p>}</form>;
}
export function Input({label,name,value='',type='text',required=true,min,max,step}:{label:string;name:string;value?:string|number;type?:string;required?:boolean;min?:number;max?:number;step?:string}){
  return <label>{label}<input name={name} type={type} defaultValue={value} required={required} min={min} max={max} step={step} maxLength={type==='password'?128:120}/></label>;
}
export function Select({name,label,options,value='',required=true}:{name:string;label:string;options:{id:number|string;name:string}[];value?:number|string;required?:boolean}){
  return <label>{label}<select name={name} required={required} defaultValue={value}><option value="">{required?'Välj…':'Alla / ingen vald'}</option>{options.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
}
export function pickOptions(lookups:Lookups){return lookups.products.filter(x=>x.active).map(x=>({id:x.id,name:x.sku+' · '+x.name}))}
export function binOptions(lookups:Lookups){return lookups.locations.filter(x=>x.active).map(x=>({id:x.id,name:x.code}))}
export const nameOf=(lookups:Lookups,id:number)=>lookups.products.find(p=>p.id===id)?.name??'Okänd artikel';
export const skuOf=(lookups:Lookups,id:number)=>lookups.products.find(p=>p.id===id)?.sku??'—';
export const binOf=(lookups:Lookups,id:number)=>lookups.locations.find(l=>l.id===id)?.code??'—';
export const str=(f:FormData,k:string)=>String(f.get(k)??'');
export const int=(f:FormData,k:string)=>Number(str(f,k));
export type PageProps={lookups:Lookups;version:number;supervisor:boolean;changed:(message:string)=>void;userId:string};
