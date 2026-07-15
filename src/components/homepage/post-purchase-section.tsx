import { homepageConfig } from "@/config/homepage"; import { FeaturePanel } from "./feature-panel";
export function PostPurchaseSection(){return <FeaturePanel id="post-purchase" section={homepageConfig.postPurchase} visualTitle="Resolution flow" visualItems={["Request","Policy review","Approval / pickup","Store credit or other resolution"]}/>;}
