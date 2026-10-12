import { getDb } from '@/lib/db';
import {buildPerformanceIndex,type SourcePerformance} from './source-performance';
const WINDOW_RUNS=400;
/** Question-derived feedback is read from the current public corpus, with no stale text cache. */
export async function getSourcePerformance(sourceId:string):Promise<{performance:SourcePerformance|null;windowRuns:number}> {
  try {const index=buildPerformanceIndex(await(await getDb()).listRecentQueries(WINDOW_RUNS));return {performance:index[sourceId]??null,windowRuns:WINDOW_RUNS};}
  catch{return {performance:null,windowRuns:WINDOW_RUNS};}
}
