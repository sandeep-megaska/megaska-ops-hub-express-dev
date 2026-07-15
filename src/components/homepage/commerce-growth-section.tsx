import { homepageConfig } from "@/config/homepage"; import { FeaturePanel } from "./feature-panel";
export function CommerceGrowthSection(){return <FeaturePanel id="commerce-growth" section={homepageConfig.growth} reverse visualTitle="Smart cart placeholder" visualItems={["Cart content","Promotion rule","Complementary offer","Estimated benefit"]}/>;}
