export type AnalyticsRange={start:Date;end:Date;comparisonStart:Date;comparisonEnd:Date;timezone:string;label:string};
const DAY=86_400_000, MAX_DAYS=731;
function dateOnly(value:string,end=false){const d=new Date(`${value}T${end?"23:59:59.999":"00:00:00.000"}Z`);if(Number.isNaN(d.getTime()))throw new Error("Invalid date range.");return d}
export function resolveReviewAnalyticsRange(params:URLSearchParams,now=new Date(),timezone="UTC"):AnalyticsRange{
 const preset=params.get("range")||"30"; let start:Date,end:Date,label="Last 30 days";
 if(preset==="custom"){start=dateOnly(params.get("start")||"");end=dateOnly(params.get("end")||"",true);label="Custom range"} else {const days=({"7":7,"30":30,"90":90,"365":365} as Record<string,number>)[preset];if(!days)throw new Error("Invalid range preset."); end=new Date(now);start=new Date(end.getTime()-(days*DAY));label=`Last ${days===365?"12 months":`${days} days`}`}
 if(start>end||end.getTime()-start.getTime()>MAX_DAYS*DAY)throw new Error("Date range must be ordered and no longer than 24 months."); const duration=end.getTime()-start.getTime()+1;
 return {start,end,comparisonStart:new Date(start.getTime()-duration),comparisonEnd:new Date(start.getTime()-1),timezone,label};
}
export function comparison(value:number,previousValue:number):import("./review-analytics-definitions").MetricComparison{return {value,previousValue,absoluteChange:value-previousValue,percentageChange:previousValue===0?null:((value-previousValue)/previousValue)*100}}
