uniform float time;
uniform float orbitRadius;
uniform float orbitSpeed;
varying vec3 vColor;
varying vec3 vNormal;
attribute vec3 glyphCenter;
attribute float glyphIndex;

void main() {
  vColor = color;
  vNormal = normalize(normalMatrix * normal);
  
  float phase = glyphIndex * 0.3;
  float angle = time * orbitSpeed + phase;
  
  vec2 circularOffset = vec2(cos(angle), sin(angle)) * orbitRadius;
  float zOffset = sin(angle * 1.5) * orbitRadius * 1.5;
  
  vec3 pos = position + vec3(circularOffset.x, circularOffset.y, zOffset);
  
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}

