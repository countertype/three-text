uniform float time;
uniform float explodeSpeed;
uniform float explodeDistance;
uniform vec3 paragraphCenter;
varying vec3 vColor;
varying vec3 vNormal;
attribute vec3 glyphCenter;
attribute float glyphIndex;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
}

vec3 hash3(vec3 p) {
  return vec3(
    hash(p),
    hash(p + vec3(1.0)),
    hash(p + vec3(2.0))
  );
}

float easeOutElastic(float t) {
  float c4 = (2.0 * 3.14159) / 3.0;
  return t == 0.0 ? 0.0 : t == 1.0 ? 1.0 : 
         pow(2.0, -10.0 * t) * sin((t * 10.0 - 0.75) * c4) + 1.0;
}

mat4 rotationMatrix(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;
  
  return mat4(
    oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
    oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
    oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
    0.0,                                0.0,                                0.0,                                1.0
  );
}

void main() {
  vColor = color;
  
  float distFromCenter = length(glyphCenter - paragraphCenter);
  
  vec3 glyphSeed = glyphCenter * 0.01;
  vec3 vertexSeed = position * 0.01;
  vec3 chaos = hash3(glyphSeed) - 0.5;
  
  vec3 radialDir = normalize(glyphCenter - paragraphCenter);
  vec3 chaoticDir = normalize(radialDir + chaos * 2.5);
  
  float cycleTime = time * explodeSpeed;
  float cycleDuration = 8.0;
  float t = mod(cycleTime, cycleDuration);
  
  float shockwaveDelay = distFromCenter * 0.0008;
  float phaseT = t - shockwaveDelay;
  
  float offset = 0.0;
  float tumbleAngle = 0.0;
  float scatter = 0.0;
  
  if (phaseT < 2.4 && phaseT >= 0.0) {
    float outT = phaseT / 2.4;
    float curve = outT * outT * (3.0 - 2.0 * outT);
    offset = explodeDistance * 4.8 * curve;
    tumbleAngle = 40.0 * (hash(glyphSeed) - 0.5) * curve;
    scatter = 200.0 * curve;
  }
  else if (phaseT >= 2.4 && phaseT < 3.2) {
    offset = explodeDistance * 4.8;
    tumbleAngle = 40.0 * (hash(glyphSeed) - 0.5);
    scatter = 200.0;
  }
  else if (phaseT >= 3.2 && phaseT < 5.8) {
    float returnT = (phaseT - 3.2) / 2.6;
    float curve = returnT * returnT * (3.0 - 2.0 * returnT);
    offset = explodeDistance * 4.8 * (1.0 - curve);
    tumbleAngle = 40.0 * (hash(glyphSeed) - 0.5) * (1.0 - curve);
    scatter = 200.0 * (1.0 - curve);
  }
  
  vec3 pos = position;
  
  vec3 tumbleAxis = normalize(chaos);
  mat4 rotation = rotationMatrix(tumbleAxis, tumbleAngle);
  vec3 localPos = pos - glyphCenter;
  pos = (rotation * vec4(localPos, 1.0)).xyz + glyphCenter;
  
  vec3 vertexChaos = (hash3(vertexSeed) - 0.5) * scatter;
  pos += vertexChaos;
  pos += chaoticDir * offset;
  
  vec3 rotatedNormal = (rotation * vec4(normal, 0.0)).xyz;
  vNormal = normalize(normalMatrix * rotatedNormal);
  
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}

