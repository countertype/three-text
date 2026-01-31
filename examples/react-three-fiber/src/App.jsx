import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useControls, button, monitor, folder } from "leva";
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

const DEFAULT_TEXT = `three-text is a 3D font geometry and text layout library for the web. Its supports TTF, OTF, and WOFF font files. For layout, it uses Tex-based parameters for breaking text into paragraphs across multiple lines and supports CJK and RTL scripts. three-text caches the geometries it generates for low CPU overhead in languages with lots of repeating glyphs. Variable fonts are supported as static instances at a given axis coordinate, and can be animated by re-drawing each frame with new coordinates. The library has a framework-agnostic core that returns raw vertex data, with lightweight adapters for Three.js, React Three Fiber, p5.js, WebGL and WebGPU. Under the hood, three-text relies on HarfBuzz for text shaping, Knuth-Plass line breaking, Liang hyphenation, libtess by Eric Veach for tessellation, curve polygonization from Maxim Shemanarev's Anti-Grain Geometry, and Visvalingam-Whyatt line simplification`;

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
  const [availableFeatures, setAvailableFeatures] = useState(null);
  const [featureNames, setFeatureNames] = useState({});
  const [fontFeatures, setFontFeatures] = useState({});
  const textMeshRef = useRef();
  const renderStartTimeRef = useRef(null);
  const lastColorRef = useRef(null);

  const handleFontLoad = (fontBuffer, fontName) => {
    setCustomFont({ buffer: fontBuffer, name: fontName });
    setCurrentFontName(fontName);
    setVariationAxes(null);
    setFontVariations({});
    setAvailableFeatures(null);
    setFontFeatures({});
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


  const [textControls] = useControls(
    "Text",
    () => {
      const config = {
        text: {
          value: DEFAULT_TEXT,
          rows: true,
        },
        fontSize: { value: 72, min: 30, max: 150, step: 5 },
        letterSpacing: { value: 0, min: -0.1, max: 0.2, step: 0.01 },
        direction: { value: "ltr", options: ["ltr", "rtl"] },
        depth: { value: 7, min: 0, max: 50, step: 1 },
        color: { value: "#ffffff" },
        backgroundColor: { value: "#111111" },
        wireframe: false,
        removeOverlaps: { 
          value: null, 
          options: { 
            "Auto (VF=on, Static=off)": null, 
            "Force On": true, 
            "Force Off": false 
          } 
        },
      };

      if (!availableFeatures || !Array.isArray(availableFeatures) || availableFeatures.length === 0) {
        config["OpenType features"] = folder(
          {
            "No features": { value: "None detected", editable: false },
          },
          { collapsed: true }
        );
      } else {
        const defaultEnabled = new Set([
          "abvm",
          "blwm",
          "ccmp",
          "locl",
          "mark",
          "mkmk",
          "rlig",
          "calt",
          "clig",
          "curs",
          "dist",
          "kern",
          "liga",
          "rclt",
        ]);

        const featureControls = {};
        for (const tag of availableFeatures) {
          // For stylistic sets / character variants, keep tag prefix (ss01, cv01) in the label
          let label = featureNames[tag] || tag;
          if (/^(ss|cv)\d{2}$/.test(tag) && featureNames[tag]) {
            label = `${tag}: ${featureNames[tag]}`;
          }

          featureControls[label] = {
            value:
              fontFeatures[tag] !== undefined
                ? fontFeatures[tag]
                : defaultEnabled.has(tag),
            onChange: (value) => {
              setFontFeatures((prev) => ({ ...prev, [tag]: value }));
            },
          };
        }

        config["OpenType features"] = folder(featureControls, {
          collapsed: true,
        });
      }

      return config;
    },
    [availableFeatures, featureNames, fontFeatures]
  );

  const lineBreakingControls = useControls("Line breaking", {
    lineWidth: { value: 1400, min: 500, max: 3000, step: 10 },
    lineHeight: { value: 1.33, min: 0.8, max: 2.0, step: 0.05 },
    alignment: {
      value: "justify",
      options: ["left", "center", "right", "justify"],
    },
    respectExistingBreaks: true,
    tolerance: { value: 200, min: 10, max: 10000, step: 100 },
    pretolerance: { value: 100, min: 10, max: 1000, step: 50 },
    emergencyStretch: { value: 0, min: 0, max: 1000, step: 50 },
    linepenalty: { value: 10, min: 0, max: 100, step: 1 },
    adjdemerits: { value: 10000, min: 0, max: 20000, step: 500 },
  });

  const hyphenationControls = useControls("Hyphenation", {
    hyphenate: true,
    language: {
      value: "en-us",
      options: [
        "en-us", "en-gb", "de-1996", "fr", "es", "it", "pt", "nl", "da", "sv",
        "nb", "nn", "fi", "is", "pl", "sk", "sl", "hr", "sh-cyrl", "sh-latn",
        "ru", "uk", "be", "bg", "el-monoton", "el-polyton", "hy", "ka", "tr",
        "tk", "sq", "et", "lv", "lt", "ro", "hu", "ca", "oc", "gl", "eu", "cy",
        "ga", "eo", "ia", "la", "af", "hi", "bn", "as", "gu", "pa", "or", "ml",
        "kn", "ta", "te", "mr", "sa", "th", "kmr", "hsb", "fur", "rm", "pms",
        "zh-latn-pinyin", "mn-cyrl", "mul-ethi"
      ],
    },
    lefthyphenmin: { value: 2, min: 1, max: 5, step: 1 },
    righthyphenmin: { value: 4, min: 1, max: 5, step: 1 },
    hyphenpenalty: { value: 50, min: 0, max: 500, step: 10 }, // TeX plain.tex default
    exhyphenpenalty: { value: 50, min: 0, max: 500, step: 10 }, // TeX plain.tex default
    doublehyphendemerits: { value: 10000, min: 0, max: 20000, step: 500 }, // TeX plain.tex default
  });

  const tessellationControls = useControls("Curve fidelity", {
    curveMode: { value: "adaptive", options: ["adaptive", "steps"] },
    curveSteps: { value: 100, min: 1, max: 256, step: 1, label: "Segments per curve" },
    distanceTolerance: { value: 0.5, min: 0.1, max: 10.0, step: 0.1 },
    angleTolerance: { value: 0.25, min: 0.1, max: 10.0, step: 0.05 },
  });

  const [optimizationControls] = useControls(
    "Geometry optimization", 
    () => ({
      optimizationEnabled: true,
      areaThreshold: { value: 1.0, min: 0.1, max: 15.0, step: 0.1 },
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
      side: textControls.depth === 0 ? THREE.DoubleSide : THREE.FrontSide,
      transparent: true,
      wireframe: textControls.wireframe,
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
      side: textControls.depth === 0 ? THREE.DoubleSide : THREE.FrontSide,
      transparent: true,
      defines: {
        USE_COLOR: "",
      },
    });
  }, [
    animationControls.shaderMode,
    textControls.wireframe,
    textControls.depth,
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

    const loadedFont = info.getLoadedFont();
    if (loadedFont) {
      const axes = loadedFont.variationAxes || null;
      const features = loadedFont.availableFeatures || null;
      const names = loadedFont.featureNames || {};
      
      if (axes && !variationAxes) {
        setVariationAxes(axes);
        const defaultVariations = {};
        for (const [tag, axisInfo] of Object.entries(axes)) {
          defaultVariations[tag] = axisInfo.default;
        }
        setFontVariations(defaultVariations);
      }
      
      if (features && features.length > 0 && !availableFeatures) {
        setAvailableFeatures(features);
        setFeatureNames(names);
        
        const defaultEnabled = ['abvm', 'blwm', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig', 'calt', 'clig', 'curs', 'dist', 'kern', 'liga', 'rclt'];
        const defaults = {};
        features.forEach(tag => {
          if (defaultEnabled.includes(tag)) {
            defaults[tag] = true;
          }
        });
        setFontFeatures(defaults);
      }
    }

    const triangles = info?.stats?.trianglesGenerated;
    const message = triangles 
      ? `${triangles.toLocaleString()} triangles`
      : "Ready";
    updateStatus(message, "ready");
  };

  const handleError = (error) => {
    updateStatus(`Error: ${error.message}`, "error");
  };

  const resolvedColor = useMemo(() => {
    const v = textControls.color;
    if (!v) return undefined;
    if (typeof v === "string") {
      const c = new THREE.Color(v);
      return [c.r, c.g, c.b];
    }
    // Leva can also return an object; normalize if needed
    if (typeof v === "object" && v.r !== undefined && v.g !== undefined && v.b !== undefined) {
      const r = v.r > 1 ? v.r / 255 : v.r;
      const g = v.g > 1 ? v.g / 255 : v.g;
      const b = v.b > 1 ? v.b / 255 : v.b;
      return [r, g, b];
    }
    return undefined;
  }, [textControls.color]);

  // Fast path: update color attribute directly when color changes
  useEffect(() => {
    if (!textMeshRef.current?.geometry?.attributes?.color) return;
    if (!resolvedColor) return;
    
    const lastColor = lastColorRef.current;
    if (lastColor && lastColor[0] === resolvedColor[0] && lastColor[1] === resolvedColor[1] && lastColor[2] === resolvedColor[2]) {
      return;
    }
    
    lastColorRef.current = resolvedColor;
    
    const colors = textMeshRef.current.geometry.attributes.color;
    for (let i = 0; i < colors.count; i++) {
      colors.setXYZ(i, resolvedColor[0], resolvedColor[1], resolvedColor[2]);
    }
    colors.needsUpdate = true;
  }, [resolvedColor]);

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
        key={variationAxes ? `axes-${Object.keys(variationAxes).join('-')}` : 'no-axes'}
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
        <color attach="background" args={[textControls.backgroundColor]} />
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
          color={resolvedColor}
          removeOverlaps={textControls.removeOverlaps}
          perGlyphAttributes={['flip', 'explode', 'orbit', 'twister'].includes(animationControls.shaderMode)}
          curveSteps={tessellationControls.curveMode === 'steps' ? tessellationControls.curveSteps : 0}
          curveFidelity={{
            distanceTolerance: tessellationControls.distanceTolerance,
            angleTolerance: tessellationControls.angleTolerance,
          }}
          geometryOptimization={{
            enabled: optimizationControls.optimizationEnabled,
            areaThreshold: optimizationControls.areaThreshold,
          }}
          layout={{
            width: lineBreakingControls.lineWidth,
            align: lineBreakingControls.alignment,
            direction: textControls.direction,
            hyphenate: hyphenationControls.hyphenate,
            language: hyphenationControls.language,
            respectExistingBreaks: lineBreakingControls.respectExistingBreaks,
            tolerance: lineBreakingControls.tolerance,
            pretolerance: lineBreakingControls.pretolerance,
            emergencyStretch: lineBreakingControls.emergencyStretch,
            lefthyphenmin: hyphenationControls.lefthyphenmin,
            righthyphenmin: hyphenationControls.righthyphenmin,
            linepenalty: lineBreakingControls.linepenalty,
            adjdemerits: lineBreakingControls.adjdemerits,
            hyphenpenalty: hyphenationControls.hyphenpenalty,
            exhyphenpenalty: hyphenationControls.exhyphenpenalty,
            doublehyphendemerits: hyphenationControls.doublehyphendemerits,
          }}
          fontVariations={fontVariations}
          fontFeatures={fontFeatures}
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
          {textControls.text || DEFAULT_TEXT}
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
