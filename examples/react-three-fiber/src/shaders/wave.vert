uniform float time;
uniform float waveHeight;
uniform float waveFrequency;
varying vec3 vColor;
varying vec3 vNormal;
varying float vIsBackFace;

void main() {
  vec3 pos = position;
  
  float wave = sin(position.x * waveFrequency + time) * 
              sin(position.y * waveFrequency + time);
  
  pos.x += wave * waveHeight * 0.25;
  pos.y += wave * waveHeight * 0.25;
  pos.z += wave * waveHeight;
  
  vec3 newNormal = normal;
  float waveGradientX = cos(position.x * waveFrequency + time) * waveFrequency * waveHeight * 0.25;
  float waveGradientY = cos(position.y * waveFrequency + time) * waveFrequency * waveHeight * 0.25;
  newNormal.x -= waveGradientX;
  newNormal.y -= waveGradientY;
  newNormal = normalize(newNormal);
  
  vec4 worldNormal = modelMatrix * vec4(newNormal, 0.0);
  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
  float facing = dot(worldNormal.xyz, viewDirection);
  
  if (facing < 0.0) {
    newNormal = -newNormal;
    vIsBackFace = 1.0;
  } else {
    vIsBackFace = 0.0;
  }
  
  vColor = color;
  vNormal = normalize(normalMatrix * newNormal);
  
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}


