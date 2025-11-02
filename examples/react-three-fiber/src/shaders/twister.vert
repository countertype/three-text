uniform float time;
uniform float twisterSpeed;
uniform float twisterHeight;
uniform float twisterRadius;
varying vec3 vColor;
varying vec3 vNormal;
attribute vec3 glyphCenter;
attribute float glyphIndex;
attribute float glyphLineIndex;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
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
  
  vec3 glyphSeed = glyphCenter * 0.01;
  float distanceFromCenter = length(glyphCenter.xz);
  float verticalPos = glyphCenter.y;
  
  float vortexPull = exp(-distanceFromCenter * 0.001);
  
  float glyphPhaseOffset = hash(glyphSeed) * 0.5;
  
  float t = time * twisterSpeed;
  
  float vortexAngle = t + verticalPos * 0.004 + vortexPull * 6.0 + glyphPhaseOffset;
  
  float breathe = sin(t * 0.3 + glyphPhaseOffset) * 0.2 + 1.0;
  float spiralRadius = twisterRadius * vortexPull * breathe;
  
  vec2 spiralOffset = vec2(
    cos(vortexAngle) * spiralRadius,
    sin(vortexAngle) * spiralRadius
  );
  
  float uplift = sin(vortexAngle + glyphPhaseOffset) * twisterHeight * vortexPull;
  
  vec3 pos = position;
  
  vec3 windAxis = normalize(vec3(
    hash(glyphSeed) - 0.5,
    0.8,
    hash(glyphSeed + vec3(1.0)) - 0.5
  ));
  float tumble = vortexAngle * 0.2 * vortexPull;
  
  vec3 localPos = pos - glyphCenter;
  pos = (rotationMatrix(windAxis, tumble) * vec4(localPos, 1.0)).xyz + glyphCenter;
  
  pos += vec3(spiralOffset.x, uplift, spiralOffset.y);
  
  vec3 rotatedNormal = (rotationMatrix(windAxis, tumble) * vec4(normal, 0.0)).xyz;
  vNormal = normalize(normalMatrix * rotatedNormal);
  
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}


