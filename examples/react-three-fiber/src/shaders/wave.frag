uniform float opacity;
varying vec3 vColor;
varying vec3 vNormal;
varying float vIsBackFace;

void main() {
  vec3 lightDirection = normalize(vec3(1.0, 1.0, 1.0));
  vec3 normal = normalize(vNormal);
  
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float ambient = 0.3;
  float lightIntensity = ambient + diffuse * 0.7;
  vec3 baseColor = vColor;
  
  vec3 finalColor = baseColor * lightIntensity;
  
  gl_FragColor = vec4(finalColor, opacity);
}

