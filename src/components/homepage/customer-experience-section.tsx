import { homepageConfig } from "@/config/homepage"; import { FeaturePanel } from "./feature-panel";
export function CustomerExperienceSection(){return <FeaturePanel id="customer-experience" section={homepageConfig.customer} visualTitle="Customer dashboard preview" visualItems={["OTP access","Orders","Store credit where enabled","Request status"]}/>;}
