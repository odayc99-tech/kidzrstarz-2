import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ order:vi.fn(),state:vi.fn(),running:vi.fn(),schedule:vi.fn(),video:vi.fn(),image:vi.fn(),story:vi.fn(),sign:vi.fn(),db:vi.fn() }));
vi.mock("../db",()=>({getOrderById:m.order,getDb:m.db,createOrder:vi.fn(),getUserOrders:vi.fn(),updateOrderPayment:vi.fn(),updateOrderWithImage:vi.fn(),updateOrderStory:vi.fn(),getAllOrders:vi.fn(),getOrderByGuestToken:vi.fn(),getOrdersByGuestTokens:vi.fn(),claimGuestOrders:vi.fn()}));
vi.mock("../jobs/narrationRecoveryJob",()=>({scheduleNarrationRecovery:m.schedule,isNarrationRecovering:m.running,getNarrationRecoveryState:m.state}));
vi.mock("../jobs/videoGenerationJob",()=>({scheduleVideoGeneration:m.video,isVideoGenerating:()=>false}));
vi.mock("../jobs/imageGenerationJob",()=>({scheduleImageGeneration:m.image}));
vi.mock("../jobs/storyGenerationJob",()=>({scheduleStoryGeneration:m.story}));
vi.mock("../jobs/previewGenerationJob",()=>({schedulePreviewGeneration:vi.fn(),isPreviewGenerating:()=>false}));
vi.mock("../storage",()=>({storagePut:vi.fn(),storageGet:vi.fn(),storagePublicUrl:vi.fn(),storageGetSignedUrl:vi.fn().mockResolvedValue({url:'https://signed.invalid/image'})}));
vi.mock("../services/privateMediaDelivery",()=>({privateMediaUrl:m.sign,privateDownloadUrl:vi.fn()}));
vi.mock("../services/ttsService",()=>({getAvailableVoices:()=>[]}));
vi.mock("../services/storyGeneration",()=>({getAvailableThemes:()=>[]}));
import {ordersRouter} from './orders';
let order:any, serial=2000;
const caller=(id:number|null=7)=>ordersRouter.createCaller({user:id===null?null:{id,role:'user'},req:{headers:{}},res:{}} as any);
beforeEach(()=>{
 vi.clearAllMocks();order={id:++serial,userId:7,guestToken:'ONLY_THIS_GUEST',paymentStatus:'paid',storyApproved:true,status:'completed',voiceSampleKey:'7/voice.webm',videoKey:'7/video.mp4',videoUrl:'https://old.invalid/video',generatedImageKey:'7/image.png',errorMessage:null};
 m.order.mockResolvedValue(order);m.state.mockReturnValue({pending:false,error:null});m.running.mockReturnValue(false);m.schedule.mockReturnValue(true);m.sign.mockResolvedValue('https://signed.invalid/file');
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No live network');}));
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();expect(m.db).not.toHaveBeenCalled();expect(m.image).not.toHaveBeenCalled();expect(m.video).not.toHaveBeenCalled();expect(m.story).not.toHaveBeenCalled();vi.unstubAllGlobals();});
describe('explicit recorded-voice retry authorization',()=>{
 it('queues only narration recovery after owner confirmation without touching existing media/payment',async()=>{
  const snapshot={...order};await caller().retryOwnNarration({orderId:order.id,confirm:true});
  expect(m.schedule).toHaveBeenCalledWith(order.id);expect(order).toEqual(snapshot);
 });
 it('permits the matching guest after confirmation',async()=>{
  await caller(null).retryOwnNarration({orderId:order.id,guestToken:order.guestToken,confirm:true});expect(m.schedule).toHaveBeenCalledOnce();
 });
 it.each([999,null])('denies an unauthorized caller before scheduling',async id=>{
  await expect(caller(id).retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'NOT_FOUND'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('does not accept a public share token in place of guest ownership',async()=>{
  await expect(caller(null).retryOwnNarration({orderId:order.id,guestToken:'PUBLIC_SHARE',confirm:true})).rejects.toMatchObject({code:'NOT_FOUND'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('rejects missing explicit confirmation',async()=>{
  await expect(caller().retryOwnNarration({orderId:order.id} as any)).rejects.toMatchObject({code:'BAD_REQUEST'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it.each(['unpaid','refunded'])('does not retry a %s order',async status=>{
  order.paymentStatus=status;await expect(caller().retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'BAD_REQUEST'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('requires story approval',async()=>{
  order.storyApproved=false;await expect(caller().retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'BAD_REQUEST'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('requires a saved recording',async()=>{
  order.voiceSampleKey=null;await expect(caller().retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'BAD_REQUEST'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('waits for the initial server MP4 instead of starting overlapping work',async()=>{
  order.videoKey=null;await expect(caller().retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'BAD_REQUEST'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('rejects a non-completed order before queueing even when an old video key exists',async()=>{
  order.status='processing';await expect(caller().retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'BAD_REQUEST'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('rejects a durable pending recovery',async()=>{
  m.state.mockReturnValue({pending:true,error:null});await expect(caller().retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'CONFLICT'});expect(m.schedule).not.toHaveBeenCalled();
 });
 it('does not clear the voice lease or invoke full video/story regeneration while recovery is pending',async()=>{
  m.state.mockReturnValue({pending:true,error:null});
  await expect(caller().triggerVideoGeneration({orderId:order.id})).rejects.toMatchObject({code:'CONFLICT'});
  await expect(caller().regenerateStorybookStory({orderId:order.id})).rejects.toMatchObject({code:'CONFLICT'});
 });
 it('rate limits another explicit retry after scheduling',async()=>{
  await caller().retryOwnNarration({orderId:order.id,confirm:true});await expect(caller().retryOwnNarration({orderId:order.id,confirm:true})).rejects.toMatchObject({code:'TOO_MANY_REQUESTS'});expect(m.schedule).toHaveBeenCalledOnce();
 });
 it('masks internal lease markers while returning a safe pending state without automatically retrying',async()=>{
  order.errorMessage='INTERNAL_LEASE_NONCE';m.state.mockReturnValue({pending:true,error:null});
  const result=await caller().getOrder({orderId:order.id});expect(result.narrationRetryPending).toBe(true);expect(result.errorMessage).not.toContain('INTERNAL_LEASE_NONCE');expect(result.videoKey).toBe('7/video.mp4');expect(m.schedule).not.toHaveBeenCalled();
 });
});
