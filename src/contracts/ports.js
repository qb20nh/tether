/**
 * Shared runtime contracts for interchangeable modules.
 * These are documentation typedefs (JS + JSDoc), not runtime validators.
 */

/**
 * @typedef {{r:number,c:number}} GridPoint
 */

/**
 * @typedef {{
 *   version:number,
 *   levelIndex:number,
 *   rows:number,
 *   cols:number,
 *   totalUsable:number,
 *   pathKey:string,
 *   path:Array<GridPoint>,
 *   visited:Set<string>,
 *   gridData:Array<Array<string>>,
 *   stitches:Array<[number,number]>,
 *   cornerCounts:Array<[number,number,number]>,
 *   stitchSet:Set<string>,
 *   stitchReq:Map<string, {nw:GridPoint,ne:GridPoint,sw:GridPoint,se:GridPoint}>,
 *   idxByKey:Map<string, number>,
 * }} GameSnapshot
 */

/**
 * @typedef {{
 *   version:number,
 *   rows:number,
 *   cols:number,
 *   left:number,
 *   top:number,
 *   right:number,
 *   bottom:number,
 *   size:number,
 *   gap:number,
 *   pad:number,
 *   step:number,
 * }} BoardLayoutMetrics
 */

/**
 * @typedef {{
 *   hintStatus:any,
 *   stitchStatus:any,
 *   rpsStatus:any,
 *   blockedStatus:any,
 * }} EvaluateResult
 */

/**
 * @typedef {{
 *   allVisited:boolean,
 *   hintsOk:boolean,
 *   stitchesOk:boolean,
 *   rpsOk:boolean,
 *   kind:'good'|'bad'|null,
 *   message:string,
 *   hintStatus:any,
 *   stitchStatus:any,
 *   rpsStatus:any,
 * }} CompletionResult
 */

/**
 * @typedef {{
 *   changed:boolean,
 *   rebuildGrid:boolean,
 *   validate:boolean,
 *   command:string,
 *   snapshot:GameSnapshot,
 * }} StateTransition
 */

/**
 * @typedef {{
 *   getLevel:(index:number)=>any,
 *   evaluate:(snapshot:GameSnapshot, evaluateOptions?:Record<string, any>)=>EvaluateResult,
 *   checkCompletion:(snapshot:GameSnapshot, evaluateResult:EvaluateResult, translate:(key:string, params?:Record<string, any>)=>string)=>CompletionResult,
 *   goalText:(levelIndex:number, translate:(key:string, params?:Record<string, any>)=>string)=>string,
 *   getCampaignLevelCount:()=>number,
 *   getInfiniteMaxIndex:()=>number,
 *   isInfiniteAbsIndex:(index:number)=>boolean,
 *   toInfiniteIndex:(absIndex:number)=>number,
 *   toAbsInfiniteIndex:(infiniteIndex:number)=>number,
 *   clampInfiniteIndex:(infiniteIndex:number)=>number,
 *   ensureInfiniteAbsIndex:(infiniteIndex:number)=>number,
 *   getDailyAbsIndex:()=>number,
 *   isDailyAbsIndex:(index:number)=>boolean,
 *   hasDailyLevel:()=>boolean,
 *   getDailyId:()=>string|null,
 * }} CorePort
 */

/**
 * @typedef {{
 *   loadLevel:(levelIndex:number)=>StateTransition,
 *   restoreMutableState:(savedBoard:any)=>boolean,
 *   dispatch:(command:{type:string,payload?:Record<string, any>})=>StateTransition,
 *   getSnapshot:()=>GameSnapshot,
 * }} StatePort
 */

/**
 * @typedef {{
 *   theme:string,
 *   lowPowerModeEnabled:boolean,
 *   hiddenPanels:{guide:boolean,legend:boolean},
 *   campaignProgress:number,
 *   infiniteProgress:number,
 *   dailySolvedDate:string|null,
 *   sessionBoard:null|{levelIndex:number,path:Array<[number,number]>,movableWalls:null|Array<[number,number]>,dailyId?:string|null},
 * }} BootState
 */

/**
 * @typedef {{
 *   readBootState:()=>BootState,
 *   writeTheme:(theme:string)=>void,
 *   writeLowPowerModeEnabled:(enabled:boolean)=>void,
 *   writeHiddenPanel:(panel:'guide'|'legend', hidden:boolean)=>void,
 *   writeCampaignProgress:(value:number)=>void,
 *   writeInfiniteProgress:(value:number)=>void,
 *   writeDailySolvedDate:(dailyId:string)=>void,
 *   writeSessionBoard:(board:{levelIndex:number,path:Array<[number,number]>,movableWalls:null|Array<[number,number]>,dailyId?:string|null})=>void,
 *   clearSessionBoard:()=>void,
 * }} PersistencePort
 */

/**
 * @typedef {{
 *   mount:(shellRefs?:Record<string, any>)=>void,
 *   getRefs:()=>Record<string, any>,
 *   rebuildGrid:(snapshot:GameSnapshot)=>void,
 *   renderFrame:(payload:{
 *     snapshot:GameSnapshot,
 *     evaluation:EvaluateResult,
 *     completion:CompletionResult|null,
 *     uiModel?:Record<string, any>,
 *     interactionModel?:Record<string, any>,
 *   })=>void,
 *   recordPathTransition?:(previousSnapshot:GameSnapshot, nextSnapshot:GameSnapshot, interactionModel?:Record<string, any>)=>void,
 *   clearPathTransitionCompensation?:()=>void,
 *   resize:()=>void,
 *   getLayoutMetrics?:()=>BoardLayoutMetrics|null,
 *   setLowPowerMode?:(enabled:boolean)=>void,
 *   unmount:()=>void,
 * }} RendererPort
 */

/**
 * @typedef {{
 *   bind:(payload:{
 *     refs:Record<string, any>,
 *     readSnapshot:()=>GameSnapshot,
 *     readLayoutMetrics?:()=>BoardLayoutMetrics|null,
 *     emitIntent:(intent:{type:string,payload?:Record<string, any>})=>void,
 *   })=>void,
 *   unbind:()=>void,
 * }} InputPort
 */

export default {};

