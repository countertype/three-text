varying vec3 vColor;
varying vec3 vNormal;

void main() {
  vColor = color;
  vNormal = normalize(normalMatrix * normal);

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
