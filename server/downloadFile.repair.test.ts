import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {downloadFile} from "../client/src/lib/downloadFile";
const fetchMock=vi.fn(),click=vi.fn(),create=vi.fn(),revoke=vi.fn(),append=vi.fn(),remove=vi.fn();
let link:any;
function response(blob:Blob, status=200, contentType=blob.type){return {ok:status>=200&&status<300,status,headers:new Headers({'content-type':contentType}),blob:vi.fn().mockResolvedValue(blob)};}
function mp4(){return new Blob([new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109])],{type:'video/mp4'});}
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers();
 link={click,href:'',download:'',target:'',rel:''};
 vi.stubGlobal('fetch',fetchMock);
 vi.stubGlobal('document',{createElement:vi.fn(()=>link),body:{appendChild:append,removeChild:remove}});
 vi.stubGlobal('URL',{createObjectURL:create.mockReturnValue('blob:verified'),revokeObjectURL:revoke});
 vi.stubGlobal('window',{setTimeout:(fn:()=>void,delay:number)=>setTimeout(fn,delay)});
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
describe('safe attachment downloads',()=>{
 it('rejects an empty successful response without clicking or trying a direct fallback',async()=>{
  fetchMock.mockResolvedValue(response(new Blob([],{type:'video/mp4'})));
  await expect(downloadFile('https://signed.invalid','emily.mp4')).rejects.toThrow('empty');
  expect(click).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
 });
 it('rejects an HTTP failure without downloading the error body',async()=>{
  fetchMock.mockResolvedValue(response(new Blob(['AccessDenied']),403));
  await expect(downloadFile('https://signed.invalid','emily.mp4')).rejects.toThrow('403');
  expect(click).not.toHaveBeenCalled();
 });
 it.each(['application/xml','application/json','text/html'])('rejects an error-document MIME %s',async type=>{
  fetchMock.mockResolvedValue(response(new Blob(['error'],{type})));
  await expect(downloadFile('https://signed.invalid','emily.mp4')).rejects.toThrow('error document');
  expect(click).not.toHaveBeenCalled();
 });
 it('rejects a non-MP4 body even if the MIME and filename claim MP4',async()=>{
  fetchMock.mockResolvedValue(response(new Blob(['not a video'],{type:'video/mp4'})));
  await expect(downloadFile('https://signed.invalid','emily.mp4')).rejects.toThrow('valid MP4');
  expect(click).not.toHaveBeenCalled();
 });
 it('starts a verified MP4 download and does not revoke its object URL immediately',async()=>{
  fetchMock.mockResolvedValue(response(mp4()));
  await downloadFile('https://signed.invalid','emily.mp4');
  expect(click).toHaveBeenCalledOnce();expect(link.href).toBe('blob:verified');expect(link.download).toBe('emily.mp4');
  expect(remove).toHaveBeenCalledWith(link);expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);expect(revoke).toHaveBeenCalledWith('blob:verified');
 });
 it('preserves an image attachment download without applying MP4 header checks',async()=>{
  fetchMock.mockResolvedValue(response(new Blob(['image'],{type:'image/png'})));
  await downloadFile('https://signed.invalid','emily.png');expect(click).toHaveBeenCalledOnce();
 });
 it('uses signed navigation only for network/CORS fetch failure',async()=>{
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  await downloadFile('https://signed.invalid','emily.mp4');
  expect(click).toHaveBeenCalledOnce();expect(link.href).toBe('https://signed.invalid');expect(link.target).toBe('_blank');
  expect(create).not.toHaveBeenCalled();
 });
 it('does not hide a non-network fetch error',async()=>{
  fetchMock.mockRejectedValue(new Error('Aborted'));
  await expect(downloadFile('https://signed.invalid','emily.mp4')).rejects.toThrow('Aborted');expect(click).not.toHaveBeenCalled();
 });
});
