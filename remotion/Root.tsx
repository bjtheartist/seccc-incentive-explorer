import { Composition } from "remotion";
import { ProductDemo } from "./ProductDemo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="ChicagoIncentiveExplorerDemo"
      component={ProductDemo}
      durationInFrames={1620}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{}}
    />
  );
};
