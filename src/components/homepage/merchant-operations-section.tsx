import { homepageConfig } from "@/config/homepage"; import { FeaturePanel } from "./feature-panel";
export function MerchantOperationsSection(){return <FeaturePanel id="merchant-operations" section={homepageConfig.merchant} reverse visualTitle="Merchant workspace preview" visualItems={["Request queue","Policy checks","Reverse pickup","Operational record"]}/>;}
