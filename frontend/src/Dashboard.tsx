import {useState} from 'react';
import type {CSSProperties} from 'react';
import {Link} from 'react-router-dom';
import {Activity,AlertTriangle,ArrowDownLeft,ArrowUpRight,Boxes,ClipboardList,Package,Plus,Wallet} from 'lucide-react';
import {Area,AreaChart,CartesianGrid,Cell,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import type {Dashboard as Data} from './types';
import {Badge,binOf,Load,nameOf,Table,useData} from './ui';
import type {PageProps} from './ui';
import {day,labels,money,number} from './api';

const colors=['#2563eb','#59a1ff','#19a27d','#f4a83f','#8595b5','#5b57d8'];
const dayNames=['sön','mån','tis','ons','tors','fre','lör'];
export default function Dashboard({lookups,version,supervisor}:PageProps){
  const data=useData<Data>('/dashboard',version);
  const [period,setPeriod]=useState(7);
  const [donut,setDonut]=useState('categories');
  const d=data.data;
  if(!d)return <Load error={data.error} ready={false}>{null}</Load>;
  const stats=[
    {label:'Artiklar i lager',value:number(d.articles),detail:'Aktiva i artikelregistret',icon:Package,color:'blue'},
    {label:'Totalt lagersaldo',value:number(d.quantity)+' st',detail:'Fysiskt antal i lager',icon:Boxes,color:'purple'},
    {label:'Totalt lagervärde',value:money(d.value),detail:'Baserat på inköpspris',icon:Wallet,color:'green'},
    {label:'Lågt lagersaldo',value:number(d.low),detail:'Artiklar under minsta saldo',icon:AlertTriangle,color:'amber'}
  ];
  const distribution=donut==='categories'?d.categories:d.statuses.map(x=>({name:labels[x.status],quantity:x.quantity}));
  const chart=d.activity.slice(-period).map(x=>({...x,day:dayNames[new Date(x.date+'T12:00Z').getUTCDay()]}));
  return <>
    <div className="heading"><div><h1>Översikt</h1><p>Följ lagersaldo, leveranser och pågående plock.</p></div><div className="actions"><Link className="button secondary" to="/picking"><ClipboardList size={17}/>Plocklistor</Link><Link className="button primary" to="/deliveries?new=1"><Plus size={18}/>Ny inleverans</Link></div></div>
    <div className="stats">{stats.map(x=><article className="card stat" key={x.label}><span className={'tile '+x.color}><x.icon size={21}/></span><div><p>{x.label}</p><strong>{x.value}</strong><small>{x.detail}</small></div></article>)}</div>
    <div className="daily card">{[
      {label:'Inleveranser idag',value:d.incoming,icon:ArrowDownLeft,color:'green',to:'/deliveries'},
      {label:'Utleveranser idag',value:d.outgoing,icon:ArrowUpRight,color:'blue',to:supervisor?'/orders':'/transactions'},
      {label:'Öppna plockordrar',value:d.picking,icon:ClipboardList,color:'purple',to:'/picking'}
    ].map(x=><Link key={x.label} to={x.to}><span className={'tile '+x.color}><x.icon size={19}/></span><span>{x.label}</span><strong>{number(x.value)}</strong></Link>)}</div>
    <div className="dashboard-grid">
      <section className="card panel"><header><div><h2>Lagerrörelser</h2><p>Inlevererat och skickat antal per dag</p></div><select aria-label="Period för lagerrörelser" value={period} onChange={e=>setPeriod(Number(e.target.value))}><option value={7}>Senaste 7 dagarna</option><option value={3}>Senaste 3 dagarna</option></select></header>
        <div className="chart" aria-label="Diagram över lagerrörelser"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart} margin={{left:0,right:12,top:12,bottom:0}}><CartesianGrid stroke="#e6edf6" vertical={false}/><XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={9}/><YAxis width={44} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={number}/><Tooltip labelFormatter={(_,items)=>items?.[0]?.payload?.date??''} formatter={v=>number(Number(v))}/><Area dataKey="incoming" name="Inlevererat" type="monotone" stroke="#2563eb" strokeWidth={2.5} fill="#dbeafe" fillOpacity={0.8} isAnimationActive={false}/><Area dataKey="outgoing" name="Skickat" type="monotone" stroke="#17836e" strokeWidth={2} fill="#c9eee5" fillOpacity={0.6} isAnimationActive={false}/></AreaChart></ResponsiveContainer></div>
        <div className="legend"><span><i style={{background:'#2563eb'}}/>Inlevererat</span><span><i style={{background:'#17836e'}}/>Skickat</span></div>
      </section>
      <section className="card panel"><header><div><h2>Fördelning</h2><p>Sortiment och plockorder</p></div><select aria-label="Välj fördelning" value={donut} onChange={e=>setDonut(e.target.value)}><option value="categories">Kategorier</option><option value="statuses">Plockstatus</option></select></header>
        <div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={distribution} dataKey="quantity" nameKey="name" innerRadius="63%" outerRadius="92%" paddingAngle={3} isAnimationActive={false}>{distribution.map((x,i)=><Cell key={x.name} fill={colors[i%colors.length]}/>)}</Pie><Tooltip formatter={v=>number(Number(v))}/></PieChart></ResponsiveContainer><div className="donut-total"><strong>{number(distribution.reduce((sum,x)=>sum+x.quantity,0))}</strong><span>{donut==='categories'?'enheter':'ordrar'}</span></div></div>
        <div className="legend donut-legend">{distribution.map((x,i)=><span key={x.name}><i style={{background:colors[i%colors.length]}}/>{x.name}<b>{number(x.quantity)}</b></span>)}</div>
      </section>
    </div>
    <div className="dashboard-grid"><section className="card panel recent-table"><header><div><h2>Senaste transaktioner</h2><p>De senaste förändringarna i lagret</p></div><Link className="text-link" to="/transactions">Visa alla</Link></header><Table headers={['Artikel','Typ','Plats','Antal','Datum']} rows={d.recent.map(m=>[nameOf(lookups,m.productId),<Badge status={m.type}/>,binOf(lookups,m.locationId),<span className={m.quantity>0?'positive':''}>{m.quantity>0?'+':''}{number(m.quantity)}</span>,day(m.timestamp)])}/></section>
    <div className="side-panels"><section className="card panel"><header><div><h2><AlertTriangle size={17}/> Lageraviseringar</h2><p>Artiklar att följa upp</p></div></header><div className="alerts">{d.alerts.length?d.alerts.map(x=><Link to={'/products/'+x.product.id} key={x.product.id}><span><strong>{x.product.name}</strong><small>{x.product.sku}</small></span><span className="badge status-Partial">{number(x.quantity)} / {number(x.product.minimum)} st</span></Link>):<p>Alla artiklar har tillräckligt saldo.</p>}</div></section>
    <section className="card panel"><header><div><h2><Activity size={17}/> Beläggning per zon</h2><p>Fysiskt saldo av total kapacitet</p></div><Link className="text-link" to="/locations">Lagerplatser</Link></header><div className="utilization">{d.utilization.map((z,i)=>{const percent=z.capacity?Math.round(z.quantity/z.capacity*100):0;return <div key={z.name}><label>{z.name}<strong>{percent} %</strong></label><progress max={100} value={percent} style={{"--zone-color":colors[i%colors.length]} as CSSProperties} aria-label={z.name}/></div>})}</div></section></div></div>
  </>;
}
