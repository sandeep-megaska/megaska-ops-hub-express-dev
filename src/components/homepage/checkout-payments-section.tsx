import { homepageConfig } from "@/config/homepage"; import { FeaturePanel } from "./feature-panel";
export function CheckoutPaymentsSection(){return <FeaturePanel id="checkout-payments" section={homepageConfig.checkout} visualTitle="Checkout modal placeholder" visualItems={["Express checkout","OTP at checkout","Razorpay / COD","Store credit when available"]}/>;}
