uniform float time;
uniform float flipSpeed;
uniform float flipPauseDuration;
uniform float minDiagonal;
uniform float maxDiagonal;
varying vec3 vColor;
varying vec3 vNormal;
attribute vec3 glyphCenter;
attribute float glyphIndex;
attribute float glyphLineIndex;

mat4 rotationY(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat4(
    c, 0.0, s, 0.0,
    0.0, 1.0, 0.0, 0.0,
    -s, 0.0, c, 0.0,
    0.0, 0.0, 0.0, 1.0
  );
}

float easeInOutCubic(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
  vColor = color;
  
  float diagonalValue = glyphCenter.x + glyphCenter.y;
  float normalizedDiagonal = (diagonalValue - minDiagonal) / (maxDiagonal - minDiagonal);
  
  float waveDuration = 0.7;
  float phaseOffset = normalizedDiagonal * waveDuration;
  
  float cycleTime = time * flipSpeed;
  float flipDuration = 1.5;
  float totalCycle = flipDuration + flipPauseDuration + flipDuration + flipPauseDuration;
  float t = mod(cycleTime, totalCycle);
  
  float angle = 0.0;
  
  if (t < flipDuration) {
    float progress = t - phaseOffset;
    if (progress >= 0.0 && progress <= flipDuration) {
      float normalizedT = clamp(progress / (flipDuration - waveDuration), 0.0, 1.0);
      angle = easeInOutCubic(normalizedT) * 3.14159;
    } else if (progress > flipDuration) {
      angle = 3.14159;
    }
  }
  else if (t < flipDuration + flipPauseDuration) {
    angle = 3.14159;
  }
  else if (t < flipDuration * 2.0 + flipPauseDuration) {
    float backStart = flipDuration + flipPauseDuration;
    float reversePhase = (1.0 - normalizedDiagonal) * waveDuration;
    float progress = (t - backStart) - reversePhase;
    if (progress >= 0.0 && progress <= flipDuration) {
      float normalizedT = clamp(progress / (flipDuration - waveDuration), 0.0, 1.0);
      angle = (1.0 - easeInOutCubic(normalizedT)) * 3.14159;
    } else if (progress < 0.0) {
      angle = 3.14159;
    }
  }
  
  vec3 localPos = position - glyphCenter;
  vec3 rotatedPos = (rotationY(angle) * vec4(localPos, 1.0)).xyz;
  vec3 finalPos = rotatedPos + glyphCenter;
  
  vec3 newNormal = (rotationY(angle) * vec4(normal, 0.0)).xyz;
  vNormal = normalize(normalMatrix * newNormal);
  
  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}

