import express from "express";
import "dotenv/config";
const app=express();
const PORT=process.env.PORT||3000;
app.use(express.static("."));

async function av(path){
  const key=process.env.ALPHAVANTAGE_API_KEY;
  if(!key) return {configured:false,provider:"Alpha Vantage",message:"Add ALPHAVANTAGE_API_KEY to enable live FX data."};
  const url=`https://www.alphavantage.co/query?${path}&apikey=${encodeURIComponent(key)}`;
  const r=await fetch(url); return {configured:true,provider:"Alpha Vantage",data:await r.json()};
}
app.get("/api/fx/daily",async(req,res)=>{
  try{
    const from=(req.query.from||"EUR").toUpperCase(),to=(req.query.to||"USD").toUpperCase();
    res.json(await av(`function=FX_DAILY&from_symbol=${from}&to_symbol=${to}&outputsize=compact`));
  }catch(e){res.status(502).json({error:e.message})}
});
app.get("/api/fx/rate",async(req,res)=>{
  try{
    const from=(req.query.from||"EUR").toUpperCase(),to=(req.query.to||"USD").toUpperCase();
    res.json(await av(`function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}`));
  }catch(e){res.status(502).json({error:e.message})}
});
app.get("/api/calendar",async(req,res)=>{
  const key=process.env.TRADINGECONOMICS_API_KEY;
  if(!key) return res.json({configured:false,provider:"Trading Economics",message:"Add TRADINGECONOMICS_API_KEY to enable economic-calendar data."});
  try{
    const country=req.query.country||"united states";
    const url=`https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(country)}?c=${encodeURIComponent(key)}&f=json`;
    const r=await fetch(url); res.json({configured:true,provider:"Trading Economics",data:await r.json()});
  }catch(e){res.status(502).json({error:e.message})}
});
app.listen(PORT,()=>console.log(`Forex Macro Assistant running on http://localhost:${PORT}`));
