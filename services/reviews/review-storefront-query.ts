import { prisma } from "../db/prisma.ts";
import { projectPublicReviewMedia, type PublicReviewMedia } from "./review-media-public-projection.ts";
import { isReviewSort, type ReviewSort } from "./review-sort.ts";
import { normalizeShopifyProductId, shopifyProductIdCandidates } from "./shopify-product-id.ts";

export { normalizeShopifyProductId } from "./shopify-product-id.ts";
export type { ReviewSort } from "./review-sort.ts";
export type PublicProductReview = { id:string; rating:number; title:string|null; body:string|null; customerDisplayName:string; verifiedPurchase:boolean; productTitleSnapshot:string; variantTitleSnapshot:string|null; createdAt:Date; publishedAt:Date|null; media:PublicReviewMedia[]; merchantReply?:{body:string;authorLabel:string;createdAt:Date;updatedAt:Date}|null };
export type ProductReviewSummary = { averageRating:number; reviewCount:number; rating1Count:number; rating2Count:number; rating3Count:number; rating4Count:number; rating5Count:number };
type Rating={rating:number};
type Db={productReview:{findMany(args:unknown):Promise<unknown[]>;count(args:unknown):Promise<number>}};
const select={id:true,rating:true,title:true,body:true,customerDisplayName:true,verifiedPurchase:true,productTitleSnapshot:true,variantTitleSnapshot:true,createdAt:true,publishedAt:true,media:{where:{status:"READY",deletedAt:null},orderBy:{sortOrder:"asc"},select:{mediaType:true,status:true,publicUrl:true,thumbnailUrl:true,width:true,height:true,durationSeconds:true,sortOrder:true,deletedAt:true}},merchantReply:{select:{body:true,authorLabel:true,createdAt:true,updatedAt:true}}};
const zeroSummary=():ProductReviewSummary=>({averageRating:0,reviewCount:0,rating1Count:0,rating2Count:0,rating3Count:0,rating4Count:0,rating5Count:0});
export function normalizeStorefrontPage(value:unknown,fallback=1){return typeof value==="number"&&Number.isInteger(value)&&value>=1?value:fallback}
export function normalizeStorefrontPageSize(value:unknown,fallback=10){return typeof value==="number"&&Number.isInteger(value)&&value>=1&&value<=25?value:fallback}
export { isReviewSort };
function summarize(ratings:Rating[]):ProductReviewSummary {if(!ratings.length)return zeroSummary();const counts=[0,0,0,0,0];let sum=0;for(const {rating} of ratings){counts[rating-1]++;sum+=rating}return {averageRating:sum/ratings.length,reviewCount:ratings.length,rating1Count:counts[0],rating2Count:counts[1],rating3Count:counts[2],rating4Count:counts[3],rating5Count:counts[4]}}
export async function getPublishedProductReviews({shopId,shopifyProductId,page=1,pageSize=10,sort="NEWEST",db=prisma as unknown as Db}:{shopId:string;shopifyProductId:string|number;page?:number;pageSize?:number;sort?:ReviewSort;db?:Db}) {
  const normalizedProductId=normalizeShopifyProductId(shopifyProductId);if(!normalizedProductId)throw new Error("Invalid Shopify product ID");
  const productIdCandidates=shopifyProductIdCandidates(normalizedProductId),productWhere={shopId,shopifyProductId:{in:productIdCandidates}},visibleWhere={...productWhere,status:"PUBLISHED" as const,publishedAt:{not:null},hiddenAt:null,deletedAt:null};
  const current=Math.max(1,Math.floor(page)),take=Math.min(25,Math.max(1,Math.floor(pageSize))),orderBy=sort==="HIGHEST_RATING"?[{rating:"desc"},{publishedAt:"desc"},{id:"desc"}]:sort==="LOWEST_RATING"?[{rating:"asc"},{publishedAt:"desc"},{id:"desc"}]:[{publishedAt:"desc"},{createdAt:"desc"},{id:"desc"}];
  const [countBeforePublicationFilters,rawItems,totalCount,rawRatings]=await Promise.all([db.productReview.count({where:productWhere}),db.productReview.findMany({where:visibleWhere,select,orderBy,skip:(current-1)*take,take}),db.productReview.count({where:visibleWhere}),db.productReview.findMany({where:visibleWhere,select:{rating:true}})]);
  const items=rawItems as PublicProductReview[],ratings=rawRatings as Rating[];
  console.info("review_storefront_product_list",{shopId,rawProductId:String(shopifyProductId),normalizedProductId,productIdCandidates,countBeforePublicationFilters,countAfterPublicationFilters:totalCount,returnedReviewIds:items.map(item=>item.id)});
  const totalPages=Math.ceil(totalCount/take);return {items:items.map(item=>({...item,media:projectPublicReviewMedia(item.media||[])})),summary:summarize(ratings),page:current,pageSize:take,totalCount,totalPages,hasNextPage:current<totalPages,hasPreviousPage:current>1};
}
