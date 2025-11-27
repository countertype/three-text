import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useControls, button, monitor } from "leva";
import * as THREE from "three";
import { Text } from "three-text/three/react";
import FontDropzone from "./components/FontDropzone";
import VariableFontControls from "./components/VariableFontControls";
import flipVertexShader from "./shaders/flip.vert?raw";
import explodeVertexShader from "./shaders/explode.vert?raw";
import orbitVertexShader from "./shaders/orbit.vert?raw";
import twisterVertexShader from "./shaders/twister.vert?raw";
import standardFragmentShader from "./shaders/standard.frag?raw";
import waveVertexShader from "./shaders/wave.vert?raw";
import waveFragmentShader from "./shaders/wave.frag?raw";
import offVertexShader from "./shaders/off.vert?raw";

Text.setHarfBuzzPath("/hb/hb.wasm");

function AnimationUpdater({ meshRef, animationMode, waveControls, flipControls, explodeControls, orbitControls, twisterControls }) {
  useFrame((state) => {
    if (!meshRef.current?.material?.uniforms?.time) return;

    const uniforms = meshRef.current.material.uniforms;
    uniforms.time.value = state.clock.elapsedTime;

    switch (animationMode) {
      case 'wave':
        if (uniforms.waveHeight) uniforms.waveHeight.value = waveControls.waveHeight;
        if (uniforms.waveFrequency) uniforms.waveFrequency.value = waveControls.waveFrequency;
        break;
      case 'flip':
        if (uniforms.flipSpeed) uniforms.flipSpeed.value = flipControls.flipSpeed;
        if (uniforms.flipPauseDuration) uniforms.flipPauseDuration.value = flipControls.flipPauseDuration;
        break;
      case 'explode':
        if (uniforms.explodeSpeed) uniforms.explodeSpeed.value = explodeControls.explodeSpeed;
        if (uniforms.explodeDistance) uniforms.explodeDistance.value = explodeControls.explodeDistance;
        break;
      case 'orbit':
        if (uniforms.orbitRadius) uniforms.orbitRadius.value = orbitControls.orbitRadius;
        if (uniforms.orbitSpeed) uniforms.orbitSpeed.value = orbitControls.orbitSpeed;
        break;
      case 'twister':
        if (uniforms.twisterSpeed) uniforms.twisterSpeed.value = twisterControls.twisterSpeed;
        if (uniforms.twisterHeight) uniforms.twisterHeight.value = twisterControls.twisterHeight;
        if (uniforms.twisterRadius) uniforms.twisterRadius.value = twisterControls.twisterRadius;
        break;
    }
  });
  return null;
}

function App() {
  const [customFont, setCustomFont] = useState(null);
  const [currentFontName, setCurrentFontName] = useState("Nimbus Sans");
  const [variationAxes, setVariationAxes] = useState(null);
  const [fontVariations, setFontVariations] = useState({});
  const textMeshRef = useRef();
  const renderStartTimeRef = useRef(null);

  const handleFontLoad = async (fontBuffer, fontName) => {
    setCustomFont({ buffer: fontBuffer, name: fontName });
    setCurrentFontName(fontName);

    // Detect variation axes by creating a small text sample
    // Note: This uses the imperative API - normally you'd use onLoad callback instead
    const tempResult = await Text.create({
      text: "temp",
      font: fontBuffer,
      size: 12
    });
    const axes = tempResult.getLoadedFont()?.variationAxes || null;
    
    
    // Always update axes state (this will be null for non-variable fonts)
    setVariationAxes(axes);

    // Reset variations to default (or empty for non-variable fonts)
    const defaultVariations = {};
    if (axes) {
      for (const [tag, axisInfo] of Object.entries(axes)) {
        defaultVariations[tag] = axisInfo.default;
      }
    }
    setFontVariations(defaultVariations);
  };

  const handleUploadClick = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttf,.otf,.woff";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          handleFontLoad(arrayBuffer, file.name);
        } catch (error) {
          console.error("Font loading error:", error);
          alert(`Failed to load font: ${error.message}`);
        }
      }
    };
    input.click();
  }, [handleFontLoad]);

  const [_, setFontControl] = useControls("Font", () => ({
    "Current font": {
      value: currentFontName,
      editable: false,
    },
    "Add custom font": button(() => {
      handleUploadClick();
    }),
    Privacy: monitor(() => "Stays local, not uploaded anywhere"),
  }));

  useEffect(() => {
    setFontControl({ "Current font": currentFontName });
  }, [currentFontName]);

  const textControls = useControls("Text", {
    text: {
      value:
        `three-text renders and formats text from TTF, OTF, and WOFF font files as 3D geometry. It uses Tex-based parameters for breaking text into paragraphs across multiple lines, and turns font outlines into 3D shapes on the fly, caching their geometries for low CPU overhead in languages with lots of repeating glyphs. Variable fonts are supported as static instances at a given axis coordinate. The library has a framework-agnostic core that returns raw vertex data, with lightweight adapters for Three.js, React Three Fiber, p5.js, WebGL and WebGPU. Under the hood, three-text relies on HarfBuzz for text shaping, Knuth-Plass line breaking, Liang hyphenation, libtess by Eric Veach for removing overlaps and triangulation, curve polygonization from Maxim Shemanarev's Anti-Grain Geometry, and Visvalingam-Whyatt line simplification`,
      rows: true,
    },
    fontSize: { value: 72, min: 30, max: 150, step: 5 },
    letterSpacing: { value: 0, min: -0.1, max: 0.2, step: 0.01 },
    direction: { value: "ltr", options: ["ltr", "rtl"] },
    depth: { value: 7, min: 0, max: 50, step: 1 },
  });

  const lineBreakingControls = useControls("Line breaking", {
    lineWidth: { value: 1400, min: 500, max: 3000, step: 10 },
    lineHeight: { value: 1.33, min: 0.8, max: 2.0, step: 0.05 },
    alignment: {
      value: "justify",
      options: ["left", "center", "right", "justify"],
    },
    respectExistingBreaks: true,
    disableSingleWordDetection: false,
    tolerance: { value: 200, min: 10, max: 10000, step: 100 }, // TeX plain.tex default
    pretolerance: { value: 100, min: 10, max: 1000, step: 50 }, // TeX plain.tex default
    emergencyStretch: { value: 0, min: 0, max: 1000, step: 50 }, // TeX default
    looseness: { value: 0, min: -3, max: 3, step: 1 },
    linepenalty: { value: 10, min: 0, max: 100, step: 1 }, // TeX plain.tex default
    adjdemerits: { value: 10000, min: 0, max: 20000, step: 500 }, // TeX plain.tex default
  });

  const hyphenationControls = useControls("Hyphenation", {
    hyphenate: true,
    language: {
      value: "en-us",
      options: [
        "en-us", "en-gb", "de-1996", "fr", "es", "it", "pt", "nl", "da", "sv",
        "nb", "nn", "fi", "is", "pl", "cs", "sk", "sl", "hr", "sr-cyrl",
        "sh-cyrl", "sh-latn", "ru", "uk", "be", "bg", "mk", "el-monoton",
        "el-polyton", "hy", "ka", "tr", "tk", "sq", "et", "lv", "lt", "ro",
        "hu", "ca", "oc", "gl", "eu", "cy", "ga", "eo", "ia", "la", "af",
        "id", "hi", "bn", "as", "gu", "pa", "or", "ml", "kn", "ta", "te",
        "mr", "sa", "th", "kmr", "hsb", "fur", "rm", "pms", "zh-latn-pinyin",
        "mn-cyrl", "mul-ethi"
      ],
    },
    lefthyphenmin: { value: 2, min: 1, max: 5, step: 1 },
    righthyphenmin: { value: 4, min: 1, max: 5, step: 1 },
    hyphenpenalty: { value: 50, min: 0, max: 500, step: 10 }, // TeX plain.tex default
    exhyphenpenalty: { value: 50, min: 0, max: 500, step: 10 }, // TeX plain.tex default
    doublehyphendemerits: { value: 10000, min: 0, max: 20000, step: 500 }, // TeX plain.tex default
  });

  const tessellationControls = useControls("Curve fidelity", {
    distanceTolerance: { value: 0.5, min: 0.1, max: 10.0, step: 0.1 },
    angleTolerance: { value: 0.25, min: 0.1, max: 10.0, step: 0.05 },
  });

  const [optimizationControls] = useControls(
    "Geometry optimization", 
    () => ({
      optimizationEnabled: true,
      areaThreshold: { value: 1.0, min: 0.1, max: 15.0, step: 0.1 },
      colinearThreshold: { value: 0.0087, min: 0.001, max: 0.02, step: 0.0001 },
      minSegmentLength: { value: 0.25, min: 0.1, max: 2.0, step: 0.05 },
      removeOverlaps: { 
        value: null, 
        options: { 
          "Auto (VF=on, Static=off)": null, 
          "Force On": true, 
          "Force Off": false 
        } 
      },
    }),
    [variationAxes]
  );

  const animationControls = useControls("Animation", {
    shaderMode: { value: 'wave', options: ['off', 'wave', 'flip', 'explode', 'orbit', 'twister'] },
  });

  const waveControls = useControls("Wave controls", {
    waveHeight: { value: 10, min: 0, max: 50, step: 1 },
    waveFrequency: { value: 0.01, min: 0.001, max: 0.1, step: 0.001 },
  }, { render: (get) => get('Animation.shaderMode') === 'wave' });

  const flipControls = useControls("Flip controls", {
    flipSpeed: { value: 0.3, min: 0.1, max: 3.0, step: 0.1 },
    flipPauseDuration: { value: 0.3, min: 0, max: 2.0, step: 0.1 },
  }, { render: (get) => get('Animation.shaderMode') === 'flip' });

  const explodeControls = useControls("Explode controls", {
    explodeSpeed: { value: 0.4, min: 0.1, max: 3.0, step: 0.1 },
    explodeDistance: { value: 1800, min: 100, max: 2000, step: 50 },
  }, { render: (get) => get('Animation.shaderMode') === 'explode' });

  const orbitControls = useControls("Orbit controls", {
    orbitRadius: { value: 30, min: 5, max: 100, step: 5 },
    orbitSpeed: { value: 0.5, min: 0.1, max: 5.0, step: 0.1 },
  }, { render: (get) => get('Animation.shaderMode') === 'orbit' });

  const twisterControls = useControls("Twister controls", {
    twisterSpeed: { value: 0.5, min: 0.1, max: 3.0, step: 0.1 },
    twisterHeight: { value: 150, min: 0, max: 300, step: 10 },
    twisterRadius: { value: 300, min: 50, max: 500, step: 10 },
  }, { render: (get) => get('Animation.shaderMode') === 'twister' });

  const [geometryKey, setGeometryKey] = useState(0);
  const [minDiagonal, setMinDiagonal] = useState(0);
  const [maxDiagonal, setMaxDiagonal] = useState(1);

  useEffect(() => {
    setGeometryKey(prev => prev + 1);
  }, [animationControls.shaderMode]);

  const material = useMemo(() => {
    const mode = animationControls.shaderMode;
    const baseConfig = {
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      defines: { USE_COLOR: "" },
    };

    if (mode === 'off') {
      return new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          opacity: { value: 1.0 },
        },
        vertexShader: offVertexShader,
        fragmentShader: standardFragmentShader,
        ...baseConfig,
      });
    }

    if (mode === 'flip') {
      return new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          flipSpeed: { value: flipControls.flipSpeed },
          flipPauseDuration: { value: flipControls.flipPauseDuration },
          minDiagonal: { value: minDiagonal },
          maxDiagonal: { value: maxDiagonal },
          opacity: { value: 1.0 },
        },
        vertexShader: flipVertexShader,
        fragmentShader: standardFragmentShader,
        ...baseConfig,
      });
    }

    if (mode === 'explode') {
      return new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          explodeSpeed: { value: explodeControls.explodeSpeed },
          explodeDistance: { value: explodeControls.explodeDistance },
          paragraphCenter: { value: new THREE.Vector3(0, 0, 0) },
          opacity: { value: 1.0 },
        },
        vertexShader: explodeVertexShader,
        fragmentShader: standardFragmentShader,
        ...baseConfig,
      });
    }

    if (mode === 'orbit') {
      return new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          orbitRadius: { value: orbitControls.orbitRadius },
          orbitSpeed: { value: orbitControls.orbitSpeed },
          opacity: { value: 1.0 },
        },
        vertexShader: orbitVertexShader,
        fragmentShader: standardFragmentShader,
        ...baseConfig,
      });
    }

    if (mode === 'twister') {
      return new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          twisterSpeed: { value: twisterControls.twisterSpeed },
          twisterHeight: { value: twisterControls.twisterHeight },
          twisterRadius: { value: twisterControls.twisterRadius },
          opacity: { value: 1.0 },
        },
        vertexShader: twisterVertexShader,
        fragmentShader: standardFragmentShader,
        ...baseConfig,
      });
    }

    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        waveHeight: { value: waveControls.waveHeight },
        waveFrequency: { value: waveControls.waveFrequency },
        opacity: { value: 1.0 },
      },
      vertexShader: waveVertexShader,
      fragmentShader: waveFragmentShader,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      defines: {
        USE_COLOR: "",
      },
    });
  }, [
    animationControls.shaderMode,
    waveControls.waveHeight,
    waveControls.waveFrequency,
    flipControls.flipSpeed,
    flipControls.flipPauseDuration,
    explodeControls.explodeSpeed,
    explodeControls.explodeDistance,
    orbitControls.orbitRadius,
    orbitControls.orbitSpeed,
    twisterControls.twisterSpeed,
    twisterControls.twisterHeight,
    twisterControls.twisterRadius,
    minDiagonal,
    maxDiagonal,
  ]);

  const updateStatus = (message, type = "loading") => {
    const statusEl = document.querySelector(".status");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status status-${type}`;
    }
  };

  const handleLoad = (geometry, info) => {
    if (geometry.attributes.glyphCenter) {
      const glyphCenterAttr = geometry.attributes.glyphCenter;
      let minD = Infinity;
      let maxD = -Infinity;
      
      for (let i = 0; i < glyphCenterAttr.count; i++) {
        const x = glyphCenterAttr.getX(i);
        const y = glyphCenterAttr.getY(i);
        const diagonal = x + y;
        minD = Math.min(minD, diagonal);
        maxD = Math.max(maxD, diagonal);
      }
      
      setMinDiagonal(minD);
      setMaxDiagonal(maxD);
    }

    const triangles = info?.stats?.trianglesGenerated;
    const renderTime = renderStartTimeRef.current 
      ? Math.round(performance.now() - renderStartTimeRef.current)
      : null;
    
    const message = triangles 
      ? `${triangles.toLocaleString()} triangles${renderTime ? ` in ${renderTime}ms` : ''}`
      : "Ready";
    updateStatus(message, "ready");
  };

  const handleError = (error) => {
    updateStatus(`Error: ${error.message}`, "error");
  };

  useEffect(() => {
    // This effect runs whenever text generation starts
    renderStartTimeRef.current = performance.now();
    updateStatus("Rendering text...", "loading");
  }, [textControls.text, fontVariations, optimizationControls]);

  return (
    <>
      <div className="status status-loading">Initializing...</div>

      <a className="branding" href="https://github.com/countertype/three-text" target="_blank">
        <span>three-text</span>
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>

      <FontDropzone
        onFontLoad={handleFontLoad}
        currentFontName={currentFontName}
      />

      <VariableFontControls
        key={variationAxes ? Object.keys(variationAxes).join('-') : 'none'}
        axes={variationAxes}
        variations={fontVariations}
        onVariationsChange={setFontVariations}
      />

      <Canvas
        camera={{
          position: [-20, 20, 3000],
          fov: 45,
          near: 100,
          far: 50000,
        }}
        gl={{
          antialias: true,
          precision: "highp",
          powerPreference: "high-performance",
        }}
      >
        <color attach="background" args={["#111111"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />

        <AnimationUpdater
          meshRef={textMeshRef}
          animationMode={animationControls.shaderMode}
          waveControls={waveControls}
          flipControls={flipControls}
          explodeControls={explodeControls}
          orbitControls={orbitControls}
          twisterControls={twisterControls}
        />

        <Text
          key={geometryKey}
          ref={textMeshRef}
          font={customFont?.buffer || "./fonts/NimbusSanL-Reg.woff"}
          size={textControls.fontSize}
          depth={textControls.depth}
          lineHeight={lineBreakingControls.lineHeight}
          letterSpacing={textControls.letterSpacing}
          removeOverlaps={optimizationControls.removeOverlaps}
          separateGlyphsWithAttributes={['flip', 'explode', 'orbit', 'twister'].includes(animationControls.shaderMode)}
          curveFidelity={{
            distanceTolerance: tessellationControls.distanceTolerance,
            angleTolerance: tessellationControls.angleTolerance,
          }}
          geometryOptimization={{
            enabled: optimizationControls.optimizationEnabled,
            areaThreshold: optimizationControls.areaThreshold,
            colinearThreshold: optimizationControls.colinearThreshold,
            minSegmentLength: optimizationControls.minSegmentLength,
          }}
          layout={{
            width: lineBreakingControls.lineWidth,
            align: lineBreakingControls.alignment,
            direction: textControls.direction,
            hyphenate: hyphenationControls.hyphenate,
            language: hyphenationControls.language,
            respectExistingBreaks: lineBreakingControls.respectExistingBreaks,
            disableSingleWordDetection: lineBreakingControls.disableSingleWordDetection,
            tolerance: lineBreakingControls.tolerance,
            pretolerance: lineBreakingControls.pretolerance,
            emergencyStretch: lineBreakingControls.emergencyStretch,
            lefthyphenmin: hyphenationControls.lefthyphenmin,
            righthyphenmin: hyphenationControls.righthyphenmin,
            looseness: lineBreakingControls.looseness,
            linepenalty: lineBreakingControls.linepenalty,
            adjdemerits: lineBreakingControls.adjdemerits,
            hyphenpenalty: hyphenationControls.hyphenpenalty,
            exhyphenpenalty: hyphenationControls.exhyphenpenalty,
            doublehyphendemerits: hyphenationControls.doublehyphendemerits,
          }}
          fontVariations={fontVariations}
          material={material}
          rotation={[0, 0.5, 0]}
          onLoad={(geometry, info) => {
            geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);

            if (geometry.attributes.glyphCenter) {
              const glyphCenterAttr = geometry.attributes.glyphCenter;
              for (let i = 0; i < glyphCenterAttr.count; i++) {
                glyphCenterAttr.setX(i, glyphCenterAttr.getX(i) - center.x);
                glyphCenterAttr.setY(i, glyphCenterAttr.getY(i) - center.y);
                glyphCenterAttr.setZ(i, glyphCenterAttr.getZ(i) - center.z);
              }
              glyphCenterAttr.needsUpdate = true;
            }
            
            handleLoad(geometry, info);
          }}
          onError={handleError}
        >
          {textControls.text}
        </Text>

        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          screenSpacePanning={false}
          minDistance={1000}
          maxDistance={8000}
          maxPolarAngle={Math.PI / 1.2}
          target={[0, 0, 0]}
        />
      </Canvas>
    </>
  );
}

export default App;
