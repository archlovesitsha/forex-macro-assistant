const C=["USD","EUR","GBP","JPY","CHF","CAD","AUD","NZD"];
const state={scores:Object.fromEntries(C.map(c=>[c,0])),previous:Object.fromEntries(C.map(c=>[c,0])),quotes:{},calendar:[]};
const $=x=>document.getElementById(x);
for(const a of C)for(const b of C)if(a!==b){let o=document.createElement("option");o.value=a+"/"+b;o.textContent=a+"/"+b;$("pair").append(o)}
function renderMacro(){
 $("currencies").innerHTML=C.map(c=>`<div class="currency"><b>${c}</b><input data-c="${c}" type="range" min="-10" max="10" value="${state.scores[c]}"><span class="score">${state.scores[c]}</span></div>`).join("");
 document.querySelectorAll("[data-c]").forEach(e=>e.oninput=()=>{state.scores[e.dataset.c]=+e.value;e.nextElementSibling.textContent=e.value});
 $("momentum").innerHTML=C.map(c=>`<div class="momentum"><b>${c}</b><span>${state.previous[c]} → ${state.scores[c]}</span><span>${state.scores[c]-state.previous[c]>0?"↑":state.scores[c]-state.previous[c]<0?"↓":"→"}</span><span>${state.scores[c]-state.previous[c]}</span></div>`).join("");
}
function analyse(){
 const [b,q]=$("pair").value.split("/"),d=state.scores[b]-state.scores[q];
 const priceAgainst=state.quotes[$("pair").value]?.divergence??true;
 const technical=state.quotes[$("pair").value]?.technical??0;
 let action="PASS",summary="";
 if(d>=6&&priceAgainst&&technical>=2){action="BUY "+$("pair").value;summary="Strong macro differential + divergence + technical confirmation."}
 else if(d<=-6&&priceAgainst&&technical<=-2){action="SELL "+$("pair").value;summary="Strong negative macro differential + divergence + technical confirmation."}
 else if(Math.abs(d)>=6&&priceAgainst){action="WAIT";summary="Strong macro thesis and divergence, but technical confirmation is incomplete."}
 else if(Math.abs(d)>=3){action="WATCH";summary="Moderate fundamental differential; wait for stronger divergence/confirmation."}
 else summary="Fundamental differential is too weak for this framework.";
 $("action").textContent=action;$("summary").textContent=summary;$("differential").textContent=`Differential ${d}`;
 $("divergence").textContent=`Divergence ${priceAgainst?"YES":"NO"}`;$("technical").textContent=`Technical ${technical}/3`;
 $("why").innerHTML=[`Base ${b}: ${state.scores[b]}`,`Quote ${q}: ${state.scores[q]}`,`Relative differential: ${d}`,`Price/fundamental divergence: ${priceAgainst?"present":"not detected"}`,`Technical confirmation: ${technical}/3`,`Action is rule-based decision support, not a guaranteed forecast.`].map(x=>`<li>${x}</li>`).join("");
 $("plan").innerHTML=`<div class="setup"><div><b>Direction</b><br>${action}</div><div><b>Invalidation</b><br>Set beyond the technical structure that invalidates the thesis.</div><div><b>Entry</b><br>Use a confirmed daily/4H structure break or break-and-retest.</div><div><b>Target</b><br>Use the next meaningful higher-timeframe level and maintain defined risk.</div></div>`;
}
async function api(url){const r=await fetch(url);return r.json()}
async function refresh(){
 const [b,q]=$("pair").value.split("/");
 try{
  const fx=await api(`/api/fx/rate?from=${b}&to=${q}`);
  if(fx.configured){const x=fx.data["Realtime Currency Exchange Rate"];if(x){state.quotes[`${b}/${q}`]={price:+x["5. Exchange Rate"],divergence:true,technical:0};$("quote").textContent=`${b}/${q}: ${x["5. Exchange Rate"]}`}}
  $("dataStatus").textContent=fx.configured?"Live FX provider connected.":"FX provider not configured; using local analysis.";
  $("providerStatus").textContent=fx.configured?"Alpha Vantage connection detected.":"Add provider keys to the server .env file.";
 }catch(e){$("dataStatus").textContent="Live data unavailable; local mode remains active."}
 analyse();
}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.p).classList.add("active");if(b.dataset.p==="macro")renderMacro()});
$("scan").onclick=analyse;$("refresh").onclick=refresh;$("pair").onchange=refresh;
$("calc").onclick=()=>{const n=(+$("bal").value*+$("rp").value/100)/(+$("stop").value*+$("pv").value);$("lot").textContent=`Lot size ${n.toFixed(2)} lots`};
function logs(){const a=JSON.parse(localStorage.getItem("fma2")||"[]");$("logs").innerHTML=a.map(x=>`<article class="card"><b>${x.p}</b><p>${x.n}</p><small>${x.t}</small></article>`).join("")}
$("save").onclick=()=>{let a=JSON.parse(localStorage.getItem("fma2")||"[]");a.unshift({p:$("jp").value,n:$("jn").value,t:new Date().toLocaleString()});localStorage.setItem("fma2",JSON.stringify(a));$("jp").value="";$("jn").value="";logs()};
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
renderMacro();analyse();logs();refresh();
