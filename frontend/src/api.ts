export class ApiError extends Error {
  readonly status:number;
  constructor(status:number,message:string){super(message);this.status=status}
}
export async function api<T>(path:string, method='GET', body?:unknown):Promise<T>{
  const headers:Record<string,string>={};
  if(method!=='GET'){
    const response=await fetch('/api/auth/csrf');
    if(!response.ok) throw new ApiError(response.status,'Säkerhetskontrollen misslyckades.');
    headers['X-CSRF-TOKEN']=(await response.json()).token;
    headers['Content-Type']='application/json';
  }
  const response=await fetch('/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok){
    const detail=await response.json().catch(()=>null);
    if(response.status===401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('stockflow-session'));
    throw new ApiError(response.status,detail?.detail ?? (response.status===403?'Du har inte behörighet.':response.status===404?'Sidan eller posten finns inte.':'Kunde inte hämta eller spara uppgifterna.'));
  }
  return response.headers.get('content-type')?.includes('json') ? response.json() : undefined as T;
}
export const action=(path:string, input:object={})=>api(path,'POST',{operationId:crypto.randomUUID(),...input});
export const query=(values:Record<string,string|number>)=>'?'+new URLSearchParams(Object.entries(values).filter(([,v])=>v!=='').map(([k,v])=>[k,String(v)])).toString();
export const number=(n:number)=>new Intl.NumberFormat('sv-SE').format(n);
export const money=(n:number,digits=0)=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);
export const day=(d:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d.length===10?d+'T12:00:00Z':/Z$|[+-]\d\d:\d\d$/.test(d)?d:d+'Z'));
export const labels:Record<string,string>={Administrator:'Administratör',Supervisor:'Arbetsledare',Worker:'Lagermedarbetare',Planned:'Planerad',InProgress:'Pågående',Partial:'Dellevererad',Completed:'Slutförd',Waiting:'Väntar',Reserved:'Reserverad',Picking:'Plockning pågår',Picked:'Färdigplockad',Shipped:'Skickad',Cancelled:'Avbruten',Draft:'Utkast',Approved:'Godkänd',Receipt:'Inleverans',Shipment:'Utleverans',TransferIn:'Flytt in',TransferOut:'Flytt ut',Adjustment:'Justering',Active:'Aktiv',Inactive:'Inaktiv',Low:'Lågt saldo'};
