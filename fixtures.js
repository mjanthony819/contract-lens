export const oldSpec={
  "openapi": "3.0.3",
  "info": {
    "title": "Dispatch API",
    "version": "1.4.0"
  },
  "paths": {
    "/orders": {
      "post": {
        "summary": "Create an order",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OrderInput"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Order"
                }
              }
            }
          }
        }
      }
    },
    "/orders/{id}": {
      "get": {
        "summary": "Read an order",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Order",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Order"
                }
              }
            }
          }
        }
      }
    },
    "/health": {
      "get": {
        "responses": {
          "200": {
            "description": "Healthy"
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "OrderInput": {
        "type": "object",
        "required": [
          "sku",
          "quantity"
        ],
        "properties": {
          "sku": {
            "type": "string",
            "minLength": 1
          },
          "quantity": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100
          },
          "shipping": {
            "type": "string",
            "enum": [
              "standard",
              "express"
            ]
          }
        },
        "additionalProperties": false
      },
      "Order": {
        "type": "object",
        "required": [
          "id",
          "status"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "shipped"
            ]
          }
        },
        "additionalProperties": false
      }
    }
  }
};
export const breakingSpec=JSON.parse(JSON.stringify(oldSpec));breakingSpec.info.version='2.0.0';breakingSpec.components.schemas.OrderInput.properties.quantity.maximum=10;breakingSpec.components.schemas.OrderInput.required.push('warehouse');breakingSpec.components.schemas.OrderInput.properties.warehouse={type:'string',minLength:1};breakingSpec.components.schemas.Order.properties.status.enum.push('cancelled');delete breakingSpec.paths['/health'];
export const safeSpec=JSON.parse(JSON.stringify(oldSpec));safeSpec.info.version='1.5.0';safeSpec.components.schemas.OrderInput.properties.quantity.maximum=200;safeSpec.paths['/status']={get:{responses:{'200':{description:'OK'}}}};
export const reviewSpec=JSON.parse(JSON.stringify(oldSpec));reviewSpec.info.version='2.0-review';reviewSpec.components.schemas.OrderInput.properties.sku.pattern='^[A-Z]+$';reviewSpec.components.schemas.Order.properties.status={oneOf:[{type:'string'},{type:'integer'}]};
