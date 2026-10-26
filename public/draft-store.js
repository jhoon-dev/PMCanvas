export class DraftStore{
 constructor(userId,storage=globalThis.localStorage){this.userId=userId;this.storage=storage;}
 key(id){return 'pmcanvas:draft:v1:'+this.userId+':'+id;}
 write(base,draft,pending){this.storage.setItem(this.key(base.id),JSON.stringify({version:1,projectId:base.id,userId:this.userId,revision:draft._revision,savedAt:new Date().toISOString(),draft,pending:[...pending.values()]}));}
 read(id){const raw=this.storage.getItem(this.key(id));if(!raw)return null;const value=JSON.parse(raw);if(value.version!==1||value.userId!==this.userId||value.projectId!==id||value.draft?.id!==id||!Array.isArray(value.pending)||value.pending.length>4000)throw Error('복구 초안 형식을 확인할 수 없습니다.');return value;}
 remove(id){this.storage.removeItem(this.key(id));}
}
